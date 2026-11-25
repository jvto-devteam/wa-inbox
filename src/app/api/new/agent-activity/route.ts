import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/get-session'
import { prisma } from '@/lib/db'
import { HISTORY_MAX_DAYS } from '@/lib/chat-review/history'
import { jakartaDayKey } from '@/lib/daily-summary/time'
import { indexPointCounts, previousPointCount } from '@/lib/new/review-points'
import {
  TEMPLATE_AGENT, fromEvent, fromJob, fromReview, fromRun, fromSummary, sortActivities, type Activity,
} from '@/lib/new/agent-activity'

/**
 * GET /api/new/agent-activity?from=ISO&to=ISO — Riwayat Agent /new dari log yang sudah ada (lihat
 * src/lib/new/agent-activity.ts). Baca saja; semua akun yang login (setara /api/bot-control/decisions).
 * Rentang maks. 31 hari; tiap sumber maks. TAKE baris terbaru supaya satu permintaan tetap ringan.
 */
const TAKE = 300
const MAX_RANGE_MS = 31 * 864e5
const EVENTS = ['EXECUTED', 'EXECUTE_FAILED', 'GUEST_ACK_SENT', 'GUEST_NOTICE_SENT', 'GUEST_NOTICE_FAILED', 'VENDOR_NOTICE_FAILED']

export async function GET(req: Request) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const url = new URL(req.url)
  const from = new Date(url.searchParams.get('from') || '')
  const to = new Date(url.searchParams.get('to') || '')
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to || to.getTime() - from.getTime() > MAX_RANGE_MS) {
    return NextResponse.json({ error: 'Parameter from/to wajib tanggal ISO, from < to, rentang maks. 31 hari' }, { status: 400 })
  }
  const range = { gte: from, lt: to }
  try {
    const [runs, jobs, events, reviews, sums, tpls] = await Promise.all([
      prisma.botDecisionRun.findMany({
        where: { startedAt: range, status: { in: ['REPLIED', 'CLARIFIED', 'HANDOFF', 'FAILED'] } },
        select: { id: true, conversationId: true, status: true, inboundText: true, replyText: true, error: true, startedAt: true },
        orderBy: { startedAt: 'desc' }, take: TAKE,
      }),
      prisma.outboundJob.findMany({
        where: { createdAt: range, templateKey: { in: Object.keys(TEMPLATE_AGENT) } },
        select: { id: true, conversationId: true, templateKey: true, status: true, lastError: true, createdAt: true, target: true, payload: true, idempotencyKey: true },
        orderBy: { createdAt: 'desc' }, take: TAKE,
      }),
      prisma.bookingActionEvent.findMany({
        where: { createdAt: range, event: { in: EVENTS } },
        select: { id: true, conversationId: true, actionId: true, event: true, actor: true, reason: true, createdAt: true },
        orderBy: { createdAt: 'desc' }, take: TAKE,
      }),
      prisma.conversation.findMany({
        where: { chatReviewAt: range, isTest: false },
        select: { id: true, chatReviewAt: true, chatReview: true },
        orderBy: { chatReviewAt: 'desc' }, take: TAKE,
      }),
      prisma.dailySummary.findMany({
        where: { startedAt: range },
        select: { id: true, date: true, status: true, error: true, startedAt: true },
      }),
      prisma.systemTemplate.findMany({ select: { key: true, name: true } }),
    ])

    // Pesan internal ke nomor (vendor/crew) tidak menyimpan conversationId: cocokkan nomor tujuannya ke
    // percakapan WhatsApp di Inbox (identitas kanal, atau nomor kontak untuk percakapan lama).
    const phones = [...new Set(jobs.filter((j) => !j.conversationId && j.target && !j.target.startsWith('grup:')).map((j) => j.target as string))]
    const byPhone = new Map<string, string>()
    if (phones.length) {
      const found = await prisma.conversation.findMany({
        where: { isTest: false, OR: [{ channelIdentity: { platform: 'WHATSAPP', externalId: { in: phones } } }, { contact: { phone: { in: phones } } }] },
        select: { id: true, channelIdentity: { select: { externalId: true } }, contact: { select: { phone: true } } },
        orderBy: { lastMessageAt: 'desc' },
      })
      for (const c of found) {
        const p = c.channelIdentity?.externalId ?? c.contact?.phone
        if (p && !byPhone.has(p)) byPhone.set(p, c.id)
      }
    }
    const chatOf = (j: (typeof jobs)[number]) => j.conversationId ?? (j.target ? byPhone.get(j.target) ?? null : null)

    const actionIds = events.map((e) => e.actionId).filter((x): x is string => !!x)
    const convIds = new Set<string>()
    for (const r of runs) convIds.add(r.conversationId)
    for (const j of jobs) { const c = chatOf(j); if (c) convIds.add(c) }
    for (const e of events) convIds.add(e.conversationId)
    for (const c of reviews) convIds.add(c.id)
    const [actions, convs] = await Promise.all([
      actionIds.length ? prisma.bookingAction.findMany({ where: { id: { in: actionIds } }, select: { id: true, field: true } }) : Promise.resolve([]),
      convIds.size ? prisma.conversation.findMany({ where: { id: { in: [...convIds] } }, select: { id: true, contact: { select: { name: true } } } }) : Promise.resolve([]),
    ])
    const nameOf = new Map(convs.map((c) => [c.id, c.contact?.name ?? null]))
    const fieldOf = new Map(actions.map((a) => [a.id, a.field]))
    const tplName = new Map(tpls.map((t) => [t.key, t.name]))
    const name = (id: string | null) => (id ? nameOf.get(id) ?? null : null)

    const out: Activity[] = []
    for (const r of runs) { const a = fromRun(r, name(r.conversationId)); if (a) out.push(a) }
    for (const j of jobs) { const c = chatOf(j); const a = fromJob(j, name(c), j.templateKey ? tplName.get(j.templateKey) : undefined, c); if (a) out.push(a) }
    for (const e of events) { const a = fromEvent(e, name(e.conversationId), e.actionId ? fieldOf.get(e.actionId) : undefined); if (a) out.push(a) }
    // Pembanding "sebelumnya" = ringkasan harian sebelum hari pembaruan. Ringkasan job 00.00 berstempel
    // akhir hari yang diringkas, jadi hari pembaruan diambil dari 1 ms sebelum chatReviewAt.
    const reviewDay = (at: Date) => jakartaDayKey(new Date(at.getTime() - 1))
    const days = reviews.flatMap((c) => (c.chatReviewAt ? [reviewDay(c.chatReviewAt)] : []))
    const history = days.length
      ? indexPointCounts(await prisma.dailySummary.findMany({
        where: { date: { lt: days.reduce((a, b) => (a > b ? a : b)) } },
        orderBy: { date: 'desc' }, take: HISTORY_MAX_DAYS, select: { date: true, payload: true },
      }))
      : []
    for (const c of reviews) {
      if (!c.chatReviewAt) continue
      const rv = (c.chatReview ?? {}) as { poinPenting?: unknown[]; status?: string }
      const a = fromReview({
        id: c.id, chatReviewAt: c.chatReviewAt, points: Array.isArray(rv.poinPenting) ? rv.poinPenting : [],
        prev: previousPointCount(history, c.id, reviewDay(c.chatReviewAt)), open: rv.status === 'perlu_tindakan',
      }, name(c.id))
      if (a) out.push(a)
    }
    for (const d of sums) out.push(fromSummary(d))
    return NextResponse.json({ items: sortActivities(out) })
  } catch (error) {
    console.error('GET /api/new/agent-activity gagal', { error })
    return NextResponse.json({ error: 'Gagal memuat riwayat agent' }, { status: 500 })
  }
}
