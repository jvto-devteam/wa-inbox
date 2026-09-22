import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import {
  DORMANT_MIN_MS,
  LOOKBACK_MS,
  RETENTION_MS,
  REVIEW_CONCURRENCY,
  RUNNING_STALE_MS,
  UNREPLIED_MIN_MS,
} from './config'
import { buildTranscript, classifyConversation, collectDay, messageSnippet, type CollectedDay } from './collect'
import { dailySummaryPayloadSchema, type ConversationReview, type DailySummaryPayload } from './payload-schema'
import { reviewConversation, type ReviewReason } from './review'
import { jakartaDayKey, jakartaDayRange } from './time'

/**
 * Membuat (atau membuat ulang) ringkasan satu hari WIB dan menyimpannya ke `DailySummary`.
 *
 * Status baris:
 * - RUNNING  sedang dibuat. Payload lama (kalau ada) dibiarkan, supaya halaman tetap bisa
 *            menampilkan versi sebelumnya selama pembuatan ulang.
 * - DONE     semua percakapan berhasil dinilai LLM.
 * - PARTIAL  sebagian gagal dinilai; yang gagal tetap tampil sebagai "belum dicek".
 * - FAILED   pengumpulan data atau penyimpanan gagal; payload lama tetap dibiarkan.
 */

export type DailySummaryStatus = 'RUNNING' | 'DONE' | 'PARTIAL' | 'FAILED'

export type GenerateResult =
  | { outcome: 'generated'; date: string; status: 'DONE' | 'PARTIAL' }
  | { outcome: 'already_running'; date: string }
  | { outcome: 'failed'; date: string }

type ReviewTarget = { conversationId: string; transcript: string; reasons: ReviewReason[] }

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const index = next++
      results[index] = await fn(items[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

/**
 * Mengklaim baris tanggal itu secara atomik. False = proses lain sedang membuatnya.
 * Baris RUNNING yang lebih tua dari RUNNING_STALE_MS dianggap sisa proses yang mati.
 */
async function claim(date: string, now: Date): Promise<boolean> {
  const staleBefore = new Date(now.getTime() - RUNNING_STALE_MS)
  const { count } = await prisma.dailySummary.updateMany({
    where: { date, OR: [{ status: { not: 'RUNNING' } }, { startedAt: { lt: staleBefore } }] },
    data: { status: 'RUNNING', startedAt: now, finishedAt: null, error: null },
  })
  if (count > 0) return true

  try {
    await prisma.dailySummary.create({ data: { date, status: 'RUNNING', startedAt: now } })
    return true
  } catch (error) {
    // P2002: baris sudah ada (RUNNING yang masih segar, atau proses lain baru saja membuatnya).
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return false
    throw error
  }
}

export function buildPayload(
  date: string,
  day: CollectedDay,
  reviews: Map<string, ConversationReview | null>,
  generatedAt: Date
): DailySummaryPayload {
  const reviewOf = (id: string) => reviews.get(id) ?? null
  const payload: DailySummaryPayload = {
    version: 1,
    date,
    windowStart: day.start.toISOString(),
    windowEnd: day.end.toISOString(),
    generatedAt: generatedAt.toISOString(),
    thresholds: { unrepliedMinMs: UNREPLIED_MIN_MS, dormantMinMs: DORMANT_MIN_MS, lookbackMs: LOOKBACK_MS },
    counts: { activeConversations: 0, inbound: 0, outbound: 0, newConversations: 0, reviewed: 0, reviewFailed: 0 },
    filteredOut: { unreplied: 0, dormant: 0 },
    unreplied: [],
    dormant: [],
    newLeads: [],
    handoffs: [],
    gaps: { newCount: day.gaps.length, openTotal: day.openGapTotal, byReason: [], byTopic: [], items: [] },
    conversations: [],
  }

  const stillWaiting = new Set<string>()

  for (const facts of day.conversations) {
    const c = classifyConversation(facts, day.start, day.end)
    const review = reviewOf(facts.conversationId)
    const ref = { conversationId: facts.conversationId, contactName: facts.contactName, pipelineStage: facts.pipelineStage }
    const closed = review?.status === 'selesai'

    if (c.activeToday) {
      payload.counts.activeConversations++
      payload.counts.inbound += facts.inboundToday
      payload.counts.outbound += facts.outboundToday
      payload.conversations.push({ ...ref, inbound: facts.inboundToday, outbound: facts.outboundToday, review })
    }
    if (c.isNewLead) {
      payload.counts.newConversations++
      payload.newLeads.push({ ...ref, createdAt: facts.createdAt.toISOString(), tripBrief: facts.tripBrief, review })
    }
    if (c.unreplied) {
      stillWaiting.add(facts.conversationId)
      if (closed) payload.filteredOut.unreplied++
      else
        payload.unreplied.push({
          ...ref,
          lastMessageAt: c.unreplied.last.createdAt.toISOString(),
          waitingMs: c.unreplied.waitingMs,
          snippet: messageSnippet(c.unreplied.last),
          review,
        })
    }
    if (c.dormant) {
      if (closed) payload.filteredOut.dormant++
      else
        payload.dormant.push({
          ...ref,
          lastMessageAt: c.dormant.last.createdAt.toISOString(),
          silentMs: c.dormant.silentMs,
          snippet: messageSnippet(c.dormant.last),
          review,
        })
    }
  }

  for (const review of reviews.values()) {
    if (review) payload.counts.reviewed++
    else payload.counts.reviewFailed++
  }

  payload.handoffs = day.handoffRuns.map((run) => ({
    runId: run.id,
    conversationId: run.conversationId,
    contactName: day.contactNames.get(run.conversationId) ?? null,
    at: run.startedAt.toISOString(),
    inboundText: run.inboundText.length > 160 ? `${run.inboundText.slice(0, 159)}…` : run.inboundText,
    stillWaiting: stillWaiting.has(run.conversationId),
  }))

  const tally = (keys: string[]) =>
    [...keys.reduce((m, k) => m.set(k, (m.get(k) ?? 0) + 1), new Map<string, number>())]
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count)
  payload.gaps.byReason = tally(day.gaps.map((g) => g.reason))
  payload.gaps.byTopic = tally(day.gaps.map((g) => g.topic))
  payload.gaps.items = day.gaps.map((g) => ({
    ...g,
    messageText: g.messageText.length > 160 ? `${g.messageText.slice(0, 159)}…` : g.messageText,
  }))

  // Paling lama menunggu dulu; pelanggan diam paling baru dulu (paling mungkin masih bisa diselamatkan).
  payload.unreplied.sort((a, b) => b.waitingMs - a.waitingMs)
  payload.dormant.sort((a, b) => a.silentMs - b.silentMs)
  payload.conversations.sort((a, b) => b.inbound + b.outbound - (a.inbound + a.outbound))

  return payload
}

/** Percakapan yang perlu dinilai LLM beserta alasannya, satu entri per percakapan. */
export function reviewTargets(day: CollectedDay): ReviewTarget[] {
  const targets: ReviewTarget[] = []
  for (const facts of day.conversations) {
    const c = classifyConversation(facts, day.start, day.end)
    const reasons: ReviewReason[] = []
    if (c.unreplied) reasons.push('unreplied')
    if (c.dormant) reasons.push('dormant')
    if (c.activeToday) reasons.push('active')
    if (reasons.length > 0) targets.push({ conversationId: facts.conversationId, transcript: buildTranscript(facts.messages), reasons })
  }
  return targets
}

/** Menghapus ringkasan hari yang lebih tua dari 30 hari. Tidak pernah melempar. */
export async function pruneDailySummaries(now: Date = new Date()): Promise<{ deleted: number }> {
  const oldestKept = jakartaDayKey(new Date(now.getTime() - RETENTION_MS))
  try {
    // "YYYY-MM-DD" terurut leksikografis sama dengan urutan tanggal.
    const { count } = await prisma.dailySummary.deleteMany({ where: { date: { lt: oldestKept } } })
    return { deleted: count }
  } catch (error) {
    console.error('pruneDailySummaries gagal', { error })
    return { deleted: 0 }
  }
}

/** Tanggal paling tua yang masih boleh dibuat (tidak langsung terpangkas). */
export function oldestRetainedDateKey(now: Date): string {
  return jakartaDayKey(new Date(now.getTime() - RETENTION_MS))
}

export async function generateDailySummary(date: string, now: Date = new Date()): Promise<GenerateResult> {
  const { start, end } = jakartaDayRange(date)
  if (!(await claim(date, now))) return { outcome: 'already_running', date }

  let model: string | undefined
  try {
    const settings = await prisma.settings.findUnique({ where: { id: 1 }, select: { ollamaModel: true } })
    model = settings?.ollamaModel ?? undefined

    const day = await collectDay(start, end)
    const targets = reviewTargets(day)
    const results = await mapWithConcurrency(targets, REVIEW_CONCURRENCY, (t) => reviewConversation(t.transcript, t.reasons, model))
    const reviews = new Map(targets.map((t, i) => [t.conversationId, results[i]]))

    const payload = dailySummaryPayloadSchema.parse(buildPayload(date, day, reviews, new Date()))
    const status = payload.counts.reviewFailed > 0 ? 'PARTIAL' : 'DONE'
    await prisma.dailySummary.update({
      where: { date },
      data: { status, model: model ?? null, finishedAt: new Date(), error: null, payload },
    })
    return { outcome: 'generated', date, status }
  } catch (error) {
    console.error('generateDailySummary gagal', { date, error })
    // Pesan mentah tidak disimpan: error Prisma/driver bisa memuat detail koneksi.
    await prisma.dailySummary
      .update({ where: { date }, data: { status: 'FAILED', model: model ?? null, finishedAt: new Date(), error: 'Gagal membuat ringkasan. Lihat log server.' } })
      .catch((updateError: unknown) => console.error('generateDailySummary: gagal menandai FAILED', { date, updateError }))
    return { outcome: 'failed', date }
  } finally {
    await pruneDailySummaries(now)
  }
}
