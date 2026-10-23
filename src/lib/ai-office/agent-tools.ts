import { z } from 'zod'
import { prisma } from '@/lib/db'
import type { AiAgentKey } from '@/lib/ai-office/activity'
import type { BookingData } from '@/lib/booking/client'
import { bookingContextForReview } from '@/lib/chat-review/booking-context'
import { refreshChatReview } from '@/lib/chat-review/refresh'
import { noteManualChatReviewRefresh } from '@/lib/chat-review/auto-refresh'
import { conversationReviewSchema } from '@/lib/daily-summary/payload-schema'
import { jakartaDayKey, jakartaDayRange } from '@/lib/daily-summary/time'
import { classifyAndStoreTopicLabels } from '@/lib/inbox/topic-labels'
import { TOPIC_LABEL_NAMES } from '@/lib/inbox/label-names'
import { RESOLVER_TOPICS } from '@/lib/bot/module-resolver'
import { runSimulation } from '@/lib/bot-control/simulator'
import { executeBookingAction } from '@/lib/booking-actions/execute'
import { closeBookingAction } from '@/lib/booking-actions/close'
import { broadcast } from '@/lib/realtime'

/**
 * Kemampuan tiap asisten Kantor AI saat diajak mengobrol operator (owner 2026-10-23: "jawaban dan action-nya sesuai
 * kapasitas masing-masing agent").
 *
 * - ALAT BACA dijalankan langsung oleh server saat LLM memintanya; hasilnya dikembalikan ke LLM untuk menyusun jawaban.
 *   Hanya ringkasan pendek: nama kontak, 4 digit akhir nomor, cuplikan ≤ 140 karakter -- tidak pernah nomor penuh,
 *   keuangan, atau isi chat utuh (LLM ini tag cloud yang sama dengan ringkasan chat; CLAUDE.md §2).
 * - TINDAKAN tidak pernah dijalankan oleh LLM. LLM hanya MENGUSULKAN; `describe` memeriksa sasarannya dan menulis
 *   kalimat konfirmasi, dan `run` baru dipanggil `POST /api/ai-office/action` sesudah operator menekan "Jalankan".
 *   Setiap tindakan memakai fungsi yang sama dengan tombolnya di Inbox (kartu booking, ringkasan, label topik, bot).
 */

export type ToolCtx = { now: Date; isAdmin: boolean }
export type ActionCtx = ToolCtx & { accountId: string }

type ReadTool = {
  name: string
  /** Label pendek yang ditampilkan di bawah jawaban ("Data: ..."). */
  label: string
  description: string
  argsHint: string
  args: z.ZodType<Record<string, unknown>>
  run: (args: Record<string, unknown>, ctx: ToolCtx) => Promise<unknown>
}

export type AgentAction = {
  name: string
  description: string
  argsHint: string
  args: z.ZodType<Record<string, unknown>>
  /** Periksa sasaran dan tulis kalimat konfirmasi; string error bila tidak bisa dijalankan. */
  describe: (args: Record<string, unknown>) => Promise<{ ok: true; summary: string } | { ok: false; error: string }>
  run: (args: Record<string, unknown>, ctx: ActionCtx) => Promise<{ result: string; conversationId?: string | null }>
}

export type AgentProfile = { name: string; role: string; scope: string; tools: ReadTool[]; actions: AgentAction[] }

const SNIPPET = 140
const LIST_LIMIT = 15
const snippet = (text: string | null | undefined) => {
  const t = (text ?? '').replace(/\s+/g, ' ').trim()
  return t.length > SNIPPET ? `${t.slice(0, SNIPPET - 1)}…` : t
}
const phoneTail = (phone: string | null | undefined) => (phone ? `…${phone.slice(-4)}` : null)
const contactName = (c: { name: string | null; phone: string | null } | null | undefined) => c?.name?.trim() || phoneTail(c?.phone) || 'Tanpa nama'
const wibTime = (d: Date | null | undefined) =>
  d ? d.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : null
const todayStart = (now: Date) => jakartaDayRange(jakartaDayKey(now)).start

// zod.object(...) bertipe objek sempit; daftar alat memegangnya sebagai Record<string, unknown>.
const obj = <T extends z.ZodRawShape>(shape: T) => z.object(shape) as unknown as z.ZodType<Record<string, unknown>>
const conversationArg = obj({ conversationId: z.string().min(1).max(64) })
const noArgs = obj({})
const idOf = (args: Record<string, unknown>, key = 'conversationId') => String(args[key])

async function conversationName(id: string): Promise<string | null> {
  const conv = await prisma.conversation.findUnique({ where: { id }, select: { contact: { select: { name: true, phone: true } } } })
  return conv ? contactName(conv.contact) : null
}

/* ------------------------------------------------------------------ alat bersama */

const searchConversations: ReadTool = {
  name: 'cari_chat',
  label: 'pencarian chat',
  description: 'Cari chat berdasarkan nama kontak, potongan nomor, atau kode booking (mis. JVTO-3752). Mengembalikan id chat.',
  argsHint: '{"q":"nama / nomor / kode booking"}',
  args: obj({ q: z.string().trim().min(2).max(60) }),
  run: async (args) => {
    const q = String(args.q)
    const digits = q.replace(/\D/g, '')
    const byContact = await prisma.conversation.findMany({
      where: {
        contact: {
          OR: [{ name: { contains: q, mode: 'insensitive' } }, ...(digits.length >= 4 ? [{ phone: { contains: digits } }] : [])],
        },
      },
      orderBy: { lastMessageAt: 'desc' },
      take: 5,
      select: { id: true },
    })
    const byBooking = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "Conversation" WHERE "bookingData"::text ILIKE ${`%${q}%`} ORDER BY "lastMessageAt" DESC LIMIT 5`
    const ids = [...new Set([...byContact.map((c) => c.id), ...byBooking.map((c) => c.id)])].slice(0, 8)
    return describeConversations(ids)
  },
}

const recentConversations: ReadTool = {
  name: 'chat_terakhir',
  label: 'chat terbaru',
  description: 'Daftar chat yang paling baru aktif (untuk "chat terakhir", "chat barusan").',
  argsHint: '{}',
  args: noArgs,
  run: async () => {
    const rows = await prisma.conversation.findMany({ orderBy: { lastMessageAt: 'desc' }, take: 6, select: { id: true } })
    return describeConversations(rows.map((r) => r.id))
  },
}

async function describeConversations(ids: string[]) {
  if (ids.length === 0) return { chat: [] }
  const rows = await prisma.conversation.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      lastMessageAt: true,
      botEnabled: true,
      bookingData: true,
      contact: { select: { name: true, phone: true } },
      channelIdentity: { select: { platform: true } },
      messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { direction: true, content: true } },
    },
  })
  return {
    chat: rows
      .sort((a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime())
      .map((c) => {
        const booking = c.bookingData as { booking_code?: unknown; code?: unknown } | null
        return {
          id: c.id,
          nama: contactName(c.contact),
          platform: c.channelIdentity?.platform ?? 'WHATSAPP',
          aktifTerakhir: wibTime(c.lastMessageAt),
          bot: c.botEnabled ? 'aktif' : 'mati',
          punyaBooking: Boolean(c.bookingData),
          kodeBooking: typeof booking?.booking_code === 'string' ? booking.booking_code : typeof booking?.code === 'string' ? booking.code : null,
          pesanTerakhir: c.messages[0] ? `${c.messages[0].direction === 'INBOUND' ? 'Tamu' : 'Kita'}: ${snippet(c.messages[0].content)}` : null,
        }
      }),
  }
}

const COMMON_TOOLS = [searchConversations, recentConversations]

/* ------------------------------------------------------------------ Tika: label topik */

const topicStats: ReadTool = {
  name: 'statistik_topik',
  label: 'statistik topik',
  description: 'Jumlah pesan tamu per topik, hari ini atau 7 hari terakhir.',
  argsHint: '{"periode":"hari_ini"|"7_hari"}',
  args: obj({ periode: z.enum(['hari_ini', '7_hari']).default('hari_ini') }),
  run: async (args, { now }) => {
    const start = args.periode === '7_hari' ? new Date(now.getTime() - 7 * 86_400_000) : todayStart(now)
    const rows = await prisma.$queryRaw<Array<{ topic: string | null; n: bigint }>>`
      SELECT "topicLabels"->>'topic' AS topic, COUNT(*)::bigint AS n FROM "Message"
      WHERE direction = 'INBOUND' AND "createdAt" >= ${start} AND "topicLabels" IS NOT NULL
      GROUP BY 1 ORDER BY 2 DESC`
    return {
      periode: args.periode,
      topik: rows.map((r) => ({ topik: r.topic, nama: TOPIC_LABEL_NAMES[r.topic as keyof typeof TOPIC_LABEL_NAMES] ?? r.topic, pesan: Number(r.n) })),
    }
  },
}

const chatsByTopic: ReadTool = {
  name: 'chat_per_topik',
  label: 'chat per topik',
  description: `Chat yang pesan tamunya berlabel topik tertentu dalam 7 hari terakhir. Topik: ${RESOLVER_TOPICS.map((t) => `${t} (${TOPIC_LABEL_NAMES[t]})`).join(', ')}.`,
  argsHint: '{"topik":"payment"}',
  args: obj({ topik: z.enum(RESOLVER_TOPICS) }),
  run: async (args, { now }) => {
    const rows = await prisma.message.findMany({
      where: { direction: 'INBOUND', createdAt: { gte: new Date(now.getTime() - 7 * 86_400_000) }, topicLabels: { path: ['topic'], equals: String(args.topik) } },
      orderBy: { createdAt: 'desc' },
      take: 40,
      select: { conversationId: true, content: true, createdAt: true },
    })
    const seen = new Map<string, { content: string | null; createdAt: Date }>()
    for (const r of rows) if (!seen.has(r.conversationId)) seen.set(r.conversationId, r)
    const ids = [...seen.keys()].slice(0, LIST_LIMIT)
    const names = await prisma.conversation.findMany({ where: { id: { in: ids } }, select: { id: true, contact: { select: { name: true, phone: true } } } })
    const nameOf = new Map(names.map((n) => [n.id, contactName(n.contact)]))
    return { chat: ids.map((id) => ({ id, nama: nameOf.get(id), pesan: snippet(seen.get(id)?.content), waktu: wibTime(seen.get(id)?.createdAt) })) }
  },
}

const conversationTopics: ReadTool = {
  name: 'topik_chat',
  label: 'topik satu chat',
  description: 'Label topik pesan-pesan tamu terbaru di satu chat.',
  argsHint: '{"conversationId":"..."}',
  args: conversationArg,
  run: async (args) => {
    const rows = await prisma.message.findMany({
      where: { conversationId: idOf(args), direction: 'INBOUND' },
      orderBy: { createdAt: 'desc' },
      take: 8,
      select: { content: true, createdAt: true, topicLabels: true },
    })
    return {
      pesan: rows.map((m) => {
        const l = m.topicLabels as { topic?: string; alsoTopics?: string[] } | null
        return { waktu: wibTime(m.createdAt), teks: snippet(m.content), topik: l?.topic ?? null, topikLain: l?.alsoTopics ?? [] }
      }),
    }
  },
}

const relabel: AgentAction = {
  name: 'label_ulang',
  description: 'Beri label topik ulang untuk pesan tamu terakhir di satu chat.',
  argsHint: '{"conversationId":"..."}',
  args: conversationArg,
  describe: async (args) => {
    const name = await conversationName(idOf(args))
    return name ? { ok: true, summary: `Label ulang topik pesan tamu terakhir di chat ${name}` } : { ok: false, error: 'Chat tidak ditemukan' }
  },
  run: async (args) => {
    const conversationId = idOf(args)
    const last = await prisma.message.findFirst({
      where: { conversationId, direction: 'INBOUND', content: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    })
    if (!last) return { result: 'Chat ini belum punya pesan teks dari tamu.', conversationId }
    const labels = await classifyAndStoreTopicLabels(last.id, 'manual')
    if (!labels) return { result: 'Gagal memberi label. Coba lagi sebentar.', conversationId }
    const extra = labels.alsoTopics.length ? ` (juga: ${labels.alsoTopics.map((t) => TOPIC_LABEL_NAMES[t]).join(', ')})` : ''
    return { result: `Topik pesan terakhir: ${TOPIC_LABEL_NAMES[labels.topic]}${extra}.`, conversationId }
  },
}

/* ------------------------------------------------------------------ Rafi: bot balasan */

const botStats: ReadTool = {
  name: 'statistik_bot',
  label: 'statistik bot hari ini',
  description: 'Jumlah keputusan bot hari ini per mode (booking_context, faq, clarify, handoff) dan per status, plus jumlah balasan.',
  argsHint: '{}',
  args: noArgs,
  run: async (_args, { now }) => {
    const start = todayStart(now)
    const [byMode, byStatus, replies] = await Promise.all([
      prisma.botDecisionRun.groupBy({ by: ['mode'], where: { startedAt: { gte: start } }, _count: { _all: true } }),
      prisma.botDecisionRun.groupBy({ by: ['status'], where: { startedAt: { gte: start } }, _count: { _all: true } }),
      prisma.botDecisionRun.count({ where: { startedAt: { gte: start }, replyText: { not: null } } }),
    ])
    return {
      perMode: Object.fromEntries(byMode.map((r) => [r.mode, r._count._all])),
      perStatus: Object.fromEntries(byStatus.map((r) => [r.status, r._count._all])),
      balasanTersusun: replies,
    }
  },
}

const botDecisions: ReadTool = {
  name: 'keputusan_bot',
  label: 'keputusan bot',
  description: 'Keputusan bot terbaru (pesan tamu, balasan bot, mode). Bisa disaring satu chat atau hanya handoff.',
  argsHint: '{"conversationId"?:"...","hanyaHandoff"?:true}',
  args: obj({ conversationId: z.string().max(64).optional(), hanyaHandoff: z.boolean().optional() }),
  run: async (args) => {
    const rows = await prisma.botDecisionRun.findMany({
      where: {
        ...(args.conversationId ? { conversationId: String(args.conversationId) } : {}),
        ...(args.hanyaHandoff ? { mode: 'handoff' } : {}),
      },
      orderBy: { startedAt: 'desc' },
      take: 8,
      select: { conversationId: true, mode: true, status: true, inboundText: true, replyText: true, startedAt: true },
    })
    const convs = await prisma.conversation.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.conversationId))] } },
      select: { id: true, contact: { select: { name: true, phone: true } } },
    })
    const nameOf = new Map(convs.map((c) => [c.id, contactName(c.contact)]))
    return {
      keputusan: rows.map((r) => ({
        conversationId: r.conversationId,
        nama: nameOf.get(r.conversationId) ?? 'Tanpa nama',
        waktu: wibTime(r.startedAt),
        mode: r.mode,
        status: r.status,
        tamu: snippet(r.inboundText),
        bot: snippet(r.replyText),
      })),
    }
  },
}

const tryReply: ReadTool = {
  name: 'coba_jawab',
  label: 'simulasi bot (tanpa kirim)',
  description: 'Simulasikan balasan bot untuk satu pesan tamu, tanpa mengirim apa pun (dry-run). Hanya untuk admin.',
  argsHint: '{"pesan":"teks pesan tamu"}',
  args: obj({ pesan: z.string().trim().min(1).max(1000) }),
  run: async (args, { isAdmin }) => {
    if (!isAdmin) return { error: 'Simulasi bot hanya untuk admin.' }
    const sim = await runSimulation({ message: String(args.pesan), dryRun: true })
    return { status: sim.status, mode: sim.mode, balasan: sim.reply, peringatan: sim.warnings.slice(0, 3) }
  },
}

function botToggle(enable: boolean): AgentAction {
  return {
    name: enable ? 'nyalakan_bot' : 'matikan_bot',
    description: enable ? 'Nyalakan bot untuk satu chat.' : 'Matikan bot untuk satu chat (admin ambil alih).',
    argsHint: '{"conversationId":"..."}',
    args: conversationArg,
    describe: async (args) => {
      const conv = await prisma.conversation.findUnique({ where: { id: idOf(args) }, select: { botEnabled: true, contact: { select: { name: true, phone: true } } } })
      if (!conv) return { ok: false, error: 'Chat tidak ditemukan' }
      if (conv.botEnabled === enable) return { ok: false, error: `Bot di chat ${contactName(conv.contact)} sudah ${enable ? 'aktif' : 'mati'}` }
      return { ok: true, summary: `${enable ? 'Nyalakan' : 'Matikan'} bot di chat ${contactName(conv.contact)}` }
    },
    run: async (args) => {
      const conversationId = idOf(args)
      await prisma.conversation.update({ where: { id: conversationId }, data: { botEnabled: enable } })
      broadcast({ type: 'conversation.updated', conversationId })
      return { result: `Bot ${enable ? 'dinyalakan' : 'dimatikan'} untuk chat ini.`, conversationId }
    },
  }
}

/* ------------------------------------------------------------------ Oka: aksi booking */

const openCards: ReadTool = {
  name: 'kartu_terbuka',
  label: 'kartu booking terbuka',
  description: 'Kartu aksi booking yang masih terbuka (CHANGE = usulan ubah, TASK = tugas admin, MISMATCH = chat beda dengan backoffice, DATA_REQUEST = draf minta data).',
  argsHint: '{}',
  args: noArgs,
  run: async () => {
    const rows = await prisma.bookingAction.findMany({
      where: { state: 'OPEN' },
      orderBy: { createdAt: 'desc' },
      take: LIST_LIMIT,
      select: { id: true, type: true, field: true, proposedValue: true, lastError: true, createdAt: true, conversationId: true, conversation: { select: { contact: { select: { name: true, phone: true } } } } },
    })
    return {
      kartu: rows.map((r) => ({
        kartuId: r.id,
        jenis: r.type,
        field: r.field,
        usulan: r.proposedValue,
        galatTerakhir: r.lastError ? snippet(r.lastError) : null,
        dibuat: wibTime(r.createdAt),
        conversationId: r.conversationId,
        nama: contactName(r.conversation.contact),
      })),
    }
  },
}

const bookingActivityToday: ReadTool = {
  name: 'aktivitas_booking_hari_ini',
  label: 'aksi booking hari ini',
  description: 'Kartu booking yang ditutup hari ini (diterapkan otomatis, disetujui, ditolak, sudah sesuai).',
  argsHint: '{}',
  args: noArgs,
  run: async (_args, { now }) => {
    const rows = await prisma.bookingAction.findMany({
      where: { closedAt: { gte: todayStart(now) } },
      orderBy: { closedAt: 'desc' },
      take: LIST_LIMIT,
      select: { field: true, state: true, closedReason: true, proposedValue: true, closedAt: true, conversationId: true, conversation: { select: { contact: { select: { name: true, phone: true } } } } },
    })
    return {
      kartu: rows.map((r) => ({ field: r.field, status: r.state, alasan: r.closedReason, nilai: r.proposedValue, waktu: wibTime(r.closedAt), conversationId: r.conversationId, nama: contactName(r.conversation.contact) })),
    }
  },
}

const bookingOfConversation: ReadTool = {
  name: 'data_booking_chat',
  label: 'data booking chat',
  description: 'Ringkasan data booking yang tertaut ke satu chat (kode, paket, tanggal, pax, jemput, antar, kaos). Tanpa keuangan.',
  argsHint: '{"conversationId":"..."}',
  args: conversationArg,
  run: async (args) => {
    const conv = await prisma.conversation.findUnique({ where: { id: idOf(args) }, select: { bookingData: true, bookingCheckedAt: true } })
    if (!conv) return { error: 'Chat tidak ditemukan' }
    return { booking: bookingContextForReview(conv.bookingData as BookingData | null) ?? 'Chat ini tidak tertaut ke booking.', dicekTerakhir: wibTime(conv.bookingCheckedAt) }
  },
}

async function describeCard(args: Record<string, unknown>, types: readonly string[], verb: string) {
  const card = await prisma.bookingAction.findUnique({
    where: { id: String(args.kartuId) },
    select: { type: true, state: true, field: true, proposedValue: true, conversation: { select: { contact: { select: { name: true, phone: true } } } } },
  })
  if (!card) return { ok: false as const, error: 'Kartu tidak ditemukan' }
  if (card.state !== 'OPEN') return { ok: false as const, error: 'Kartu sudah ditutup' }
  if (!types.includes(card.type)) return { ok: false as const, error: `Kartu ${card.type} tidak bisa di-${verb.toLowerCase()}` }
  const value = card.proposedValue === null || card.proposedValue === undefined ? '' : ` → ${JSON.stringify(card.proposedValue)}`
  return { ok: true as const, summary: `${verb} kartu ${card.field}${value} (${contactName(card.conversation.contact)})` }
}

const cardArg = obj({ kartuId: z.string().min(1).max(64), alasan: z.string().max(300).optional() })

const approveCard: AgentAction = {
  name: 'setujui_kartu',
  description: 'Setujui kartu CHANGE: tulis nilainya ke backoffice (sama dengan tombol Setujui di Inbox).',
  argsHint: '{"kartuId":"..."}',
  args: cardArg,
  describe: (args) => describeCard(args, ['CHANGE'], 'Setujui'),
  run: async (args, { accountId }) => {
    const res = await executeBookingAction({ actionId: String(args.kartuId), accountId })
    const card = await prisma.bookingAction.findUnique({ where: { id: String(args.kartuId) }, select: { conversationId: true } })
    if (res.status !== 200) return { result: `Tidak tertulis: ${res.body.error}`, conversationId: card?.conversationId ?? null }
    return { result: `Tertulis ke backoffice: ${res.body.executed.join(', ') || 'selesai'}.`, conversationId: card?.conversationId ?? null }
  },
}

function closeCard(name: string, op: 'reject' | 'done', types: readonly string[], verb: string, description: string): AgentAction {
  return {
    name,
    description,
    argsHint: '{"kartuId":"...","alasan"?:"..."}',
    args: cardArg,
    describe: (args) => describeCard(args, types, verb),
    run: async (args, { accountId }) => {
      const res = await closeBookingAction({ actionId: String(args.kartuId), op, accountId, text: args.alasan ? String(args.alasan) : 'Lewat Kantor AI' })
      if (res.status !== 200) return { result: `Tidak bisa: ${res.body.error}` }
      return { result: `Kartu ditutup (${res.body.state}).`, conversationId: res.conversationId }
    },
  }
}

/* ------------------------------------------------------------------ Sari: ringkasan & antrean */

const followUpQueue: ReadTool = {
  name: 'antrean_tindak_lanjut',
  label: 'antrean tindak lanjut',
  description: 'Item tindak lanjut yang masih terbuka: REPLY (belum dibalas), FOLLOW_UP (pelanggan diam), PROMISE (janji tim).',
  argsHint: '{"jenis"?:"REPLY"|"FOLLOW_UP"|"PROMISE"}',
  args: obj({ jenis: z.enum(['REPLY', 'FOLLOW_UP', 'PROMISE']).optional() }),
  run: async (args) => {
    const rows = await prisma.summaryItem.findMany({
      where: { state: { in: ['OPEN', 'SCHEDULED'] }, ...(args.jenis ? { kind: String(args.jenis) } : {}) },
      orderBy: { anchorAt: 'asc' },
      take: LIST_LIMIT,
      select: { kind: true, state: true, snippet: true, anchorAt: true, dueAt: true, conversationId: true, conversation: { select: { contact: { select: { name: true, phone: true } } } } },
    })
    const total = await prisma.summaryItem.count({ where: { state: { in: ['OPEN', 'SCHEDULED'] }, ...(args.jenis ? { kind: String(args.jenis) } : {}) } })
    return {
      total,
      item: rows.map((r) => ({ jenis: r.kind, status: r.state, sejak: wibTime(r.anchorAt), pengingat: wibTime(r.dueAt), cuplikan: snippet(r.snippet), conversationId: r.conversationId, nama: contactName(r.conversation.contact) })),
    }
  },
}

const conversationSummary: ReadTool = {
  name: 'ringkasan_chat',
  label: 'ringkasan chat',
  description: 'Ringkasan terbaru satu chat: alasan status, pertanyaan belum terjawab, janji tim, poin penting, label profil, langkah berikut.',
  argsHint: '{"conversationId":"..."}',
  args: conversationArg,
  run: async (args) => {
    const conv = await prisma.conversation.findUnique({ where: { id: idOf(args) }, select: { chatReview: true, chatReviewAt: true } })
    if (!conv) return { error: 'Chat tidak ditemukan' }
    const parsed = conversationReviewSchema.safeParse(conv.chatReview)
    if (!parsed.success) return { ringkasan: null, catatan: 'Chat ini belum punya ringkasan.' }
    const r = parsed.data
    const text = (x: unknown) => (typeof x === 'string' ? x : (x as { teks?: string }).teks ?? '')
    return {
      dibuat: wibTime(conv.chatReviewAt),
      status: r.status,
      alasan: r.alasan,
      jenisKontak: r.jenisKontak,
      belumTerjawab: r.pertanyaan.filter((p) => typeof p !== 'string' && p.terjawab === false).map(text),
      janjiBelumDitepati: r.janjiTim.filter((j) => typeof j !== 'string' && !j.terpenuhi).map(text),
      poinPenting: r.poinPenting.map(text),
      profil: r.profil.map((p) => p.label),
      langkahBerikut: r.langkahBerikut,
    }
  },
}

const resummarize: AgentAction = {
  name: 'ringkas_ulang',
  description: 'Buat ulang ringkasan & poin penting satu chat sekarang (sama dengan tombol "Perbarui sekarang").',
  argsHint: '{"conversationId":"..."}',
  args: conversationArg,
  describe: async (args) => {
    const name = await conversationName(idOf(args))
    return name ? { ok: true, summary: `Ringkas ulang chat ${name}` } : { ok: false, error: 'Chat tidak ditemukan' }
  },
  run: async (args, { now }) => {
    const conversationId = idOf(args)
    const res = await refreshChatReview(conversationId, now)
    noteManualChatReviewRefresh(conversationId)
    if (res.status === 'empty') return { result: 'Chat ini belum punya pesan.', conversationId }
    if (res.status === 'failed') return { result: 'Gagal meringkas. Coba lagi sebentar.', conversationId }
    return { result: 'Ringkasan & poin penting diperbarui. Lihat tab Ringkasan chat.', conversationId }
  },
}

/* ------------------------------------------------------------------ profil */

export const AGENT_PROFILES: Record<AiAgentKey, AgentProfile> = {
  topik: {
    name: 'Tika',
    role: 'pemberi label topik pesan tamu',
    scope: 'topik pesan tamu (harga, pembayaran, hotel, pembatalan, dsb.): statistik, chat per topik, label satu chat, label ulang.',
    tools: [...COMMON_TOOLS, topicStats, chatsByTopic, conversationTopics],
    actions: [relabel],
  },
  bot: {
    name: 'Rafi',
    role: 'CS bot yang membalas tamu',
    scope: 'balasan bot: statistik hari ini, keputusan & handoff terbaru, simulasi jawaban tanpa kirim, nyalakan/matikan bot per chat.',
    tools: [...COMMON_TOOLS, botStats, botDecisions, tryReply],
    actions: [botToggle(false), botToggle(true)],
  },
  booking: {
    name: 'Oka',
    role: 'ops booking yang mengubah data booking dari chat',
    scope: 'kartu aksi booking (terbuka, hari ini), data booking satu chat, setujui/tolak/selesaikan kartu.',
    tools: [...COMMON_TOOLS, openCards, bookingActivityToday, bookingOfConversation],
    actions: [
      approveCard,
      closeCard('tolak_kartu', 'reject', ['CHANGE', 'DATA_REQUEST'], 'Tolak', 'Tolak kartu CHANGE/DATA_REQUEST (sama dengan tombol Tolak).'),
      closeCard('selesaikan_kartu', 'done', ['CHANGE', 'TASK'], 'Tandai selesai', 'Tandai kartu TASK/CHANGE sudah dikerjakan manual.'),
    ],
  },
  ringkasan: {
    name: 'Sari',
    role: 'analis ringkasan chat & antrean tindak lanjut',
    scope: 'ringkasan & poin penting satu chat, antrean belum dibalas / follow up / janji tim, ringkas ulang chat.',
    tools: [...COMMON_TOOLS, followUpQueue, conversationSummary],
    actions: [resummarize],
  },
}

export function findTool(agent: AiAgentKey, name: string): ReadTool | undefined {
  return AGENT_PROFILES[agent].tools.find((t) => t.name === name)
}
export function findAction(agent: AiAgentKey, name: string): AgentAction | undefined {
  return AGENT_PROFILES[agent].actions.find((a) => a.name === name)
}
