import type { MessageDirection, SentBy } from '@prisma/client'
import { prisma } from '@/lib/db'
import {
  DORMANT_MIN_MS,
  DORMANT_STAGES,
  LOOKBACK_MS,
  SNIPPET_MAX_CHARS,
  TRANSCRIPT_MAX_CHARS_PER_MESSAGE,
  TRANSCRIPT_MAX_MESSAGES,
  UNREPLIED_MIN_MS,
} from './config'
import type { TripBriefSummary } from './payload-schema'

/**
 * Mengumpulkan bahan ringkasan satu hari WIB. Hanya membaca; tidak ada yang ditulis di sini.
 *
 * Semua penilaian memakai `end` (00:00 WIB hari berikutnya) sebagai "sekarang", bukan jam
 * dinding: laporan yang dibuat ulang siang harinya harus sama dengan yang dibuat tengah malam,
 * dan pesan yang masuk sesudah `end` bukan bagian dari hari itu.
 *
 * Percakapan `isTest` dikecualikan di setiap query.
 */

export type TranscriptMessage = {
  direction: MessageDirection
  sentBy: SentBy
  type: string
  content: string | null
  createdAt: Date
}

export type ConversationFacts = {
  conversationId: string
  contactName: string | null
  pipelineStage: string
  createdAt: Date
  tripBrief: TripBriefSummary | null
  /** Maksimal TRANSCRIPT_MAX_MESSAGES pesan terakhir sebelum `end`, lama → baru. */
  messages: TranscriptMessage[]
  inboundToday: number
  outboundToday: number
}

export type Classification = {
  activeToday: boolean
  isNewLead: boolean
  /** Pesan terakhir dari pelanggan, tanpa balasan ≥ UNREPLIED_MIN_MS. */
  unreplied: { waitingMs: number; last: TranscriptMessage } | null
  /** Pesan terakhir dari kita, pelanggan diam DORMANT_MIN_MS … LOOKBACK_MS, tahap masih lead. */
  dormant: { silentMs: number; last: TranscriptMessage } | null
}

export type CollectedDay = {
  start: Date
  end: Date
  conversations: ConversationFacts[]
  handoffRuns: Array<{ id: string; conversationId: string; startedAt: Date; inboundText: string }>
  gaps: Array<{
    id: string
    conversationId: string
    messageId: string | null
    contactName: string | null
    topic: string
    reason: string
    messageText: string
  }>
  openGapTotal: number
  /** Nama kontak untuk percakapan yang muncul di run/gap tapi tidak aktif di jendela lookback. */
  contactNames: Map<string, string | null>
}

export function classifyConversation(facts: ConversationFacts, start: Date, end: Date): Classification {
  const last = facts.messages.at(-1)
  const activeToday = facts.inboundToday + facts.outboundToday > 0
  const isNewLead = facts.createdAt >= start && facts.createdAt < end
  if (!last) return { activeToday, isNewLead, unreplied: null, dormant: null }

  const ageMs = end.getTime() - last.createdAt.getTime()
  const inLookback = ageMs <= LOOKBACK_MS

  const unreplied = last.direction === 'INBOUND' && ageMs >= UNREPLIED_MIN_MS && inLookback ? { waitingMs: ageMs, last } : null
  const dormant =
    last.direction === 'OUTBOUND' && ageMs >= DORMANT_MIN_MS && inLookback && DORMANT_STAGES.includes(facts.pipelineStage)
      ? { silentMs: ageMs, last }
      : null

  return { activeToday, isNewLead, unreplied, dormant }
}

/** Satu pesan sebagai teks pendek untuk kartu di halaman. */
export function messageSnippet(message: TranscriptMessage): string {
  const text = message.content?.trim() ? message.content.trim() : `[${message.type}]`
  return text.length > SNIPPET_MAX_CHARS ? `${text.slice(0, SNIPPET_MAX_CHARS - 1)}…` : text
}

const SPEAKER: Record<SentBy, string> = { CUSTOMER: 'Pelanggan', AGENT: 'Agen', BOT: 'Bot' }

const jakartaTimeParts = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Jakarta',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

/** "DD/MM HH.mm" WIB, disusun dari bagian-bagiannya supaya tidak bergantung pada pemisah locale. */
function jakartaStamp(at: Date): string {
  const part = (type: Intl.DateTimeFormatPartTypes) => jakartaTimeParts.formatToParts(at).find((p) => p.type === type)?.value ?? ''
  return `${part('day')}/${part('month')} ${part('hour')}.${part('minute')}`
}

/**
 * Transkrip untuk LLM. Hanya peran, waktu WIB, dan isi pesan -- nomor telepon dan nama kontak
 * sengaja tidak ikut: model produksi adalah tag `-cloud`, dan ringkasan tidak butuh keduanya.
 */
export function buildTranscript(messages: TranscriptMessage[]): string {
  return messages
    .map((m) => {
      const raw = m.content?.trim() ? m.content.trim() : `[${m.type}]`
      const text = raw.length > TRANSCRIPT_MAX_CHARS_PER_MESSAGE ? `${raw.slice(0, TRANSCRIPT_MAX_CHARS_PER_MESSAGE)}…` : raw
      return `[${jakartaStamp(m.createdAt)}] ${SPEAKER[m.sentBy]}: ${text}`
    })
    .join('\n')
}

/** Hanya field TripBrief yang ditampilkan, dengan tipe yang benar-benar dicek. Kosong → null. */
export function summarizeTripBrief(value: unknown): TripBriefSummary | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const text = (key: string) => (typeof raw[key] === 'string' && (raw[key] as string).trim() ? (raw[key] as string).trim() : undefined)
  const num = (key: string) => (typeof raw[key] === 'number' && Number.isFinite(raw[key]) ? (raw[key] as number) : undefined)
  const brief: TripBriefSummary = {
    destination: text('destination'),
    dateRange: text('dateRange'),
    pax: num('pax'),
    origin: text('origin'),
    dayCount: num('dayCount'),
    finishCity: text('finishCity'),
  }
  const present = Object.fromEntries(Object.entries(brief).filter(([, v]) => v !== undefined)) as TripBriefSummary
  return Object.keys(present).length > 0 ? present : null
}

export async function collectDay(start: Date, end: Date): Promise<CollectedDay> {
  const lookbackStart = new Date(end.getTime() - LOOKBACK_MS)
  const inDay = { gte: start, lt: end }

  const conversations = await prisma.conversation.findMany({
    where: { isTest: false, messages: { some: { createdAt: { gte: lookbackStart, lt: end } } } },
    select: { id: true, createdAt: true, pipelineStage: true, tripBrief: true, contact: { select: { name: true } } },
  })
  const ids = conversations.map((c) => c.id)

  const todayCounts = ids.length
    ? await prisma.message.groupBy({
        by: ['conversationId', 'direction'],
        where: { conversationId: { in: ids }, createdAt: inDay },
        _count: { _all: true },
      })
    : []
  const countFor = (conversationId: string, direction: MessageDirection) =>
    todayCounts.find((row) => row.conversationId === conversationId && row.direction === direction)?._count._all ?? 0

  const facts: ConversationFacts[] = []
  for (const conversation of conversations) {
    const latest = await prisma.message.findMany({
      where: { conversationId: conversation.id, createdAt: { lt: end } },
      orderBy: { createdAt: 'desc' },
      take: TRANSCRIPT_MAX_MESSAGES,
      select: { direction: true, sentBy: true, type: true, content: true, createdAt: true },
    })
    facts.push({
      conversationId: conversation.id,
      contactName: conversation.contact.name,
      pipelineStage: conversation.pipelineStage,
      createdAt: conversation.createdAt,
      tripBrief: summarizeTripBrief(conversation.tripBrief),
      messages: [...latest].reverse(),
      inboundToday: countFor(conversation.id, 'INBOUND'),
      outboundToday: countFor(conversation.id, 'OUTBOUND'),
    })
  }

  const [runs, gaps, openGapTotal] = await Promise.all([
    prisma.botDecisionRun.findMany({
      where: { status: 'HANDOFF', startedAt: inDay },
      orderBy: { startedAt: 'asc' },
      select: { id: true, conversationId: true, startedAt: true, inboundText: true },
    }),
    prisma.knowledgeGapLog.findMany({
      where: { createdAt: inDay, conversation: { isTest: false } },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        conversationId: true,
        messageId: true,
        topic: true,
        reason: true,
        messageText: true,
        conversation: { select: { contact: { select: { name: true } } } },
      },
    }),
    prisma.knowledgeGapLog.count({ where: { resolvedAt: null, conversation: { isTest: false } } }),
  ])

  // BotDecisionRun.conversationId bukan relasi, jadi `isTest` disaring lewat lookup terpisah.
  const runConversations = runs.length
    ? await prisma.conversation.findMany({
        where: { id: { in: [...new Set(runs.map((r) => r.conversationId))] } },
        select: { id: true, isTest: true, contact: { select: { name: true } } },
      })
    : []
  const realRunIds = new Set(runConversations.filter((c) => !c.isTest).map((c) => c.id))

  const contactNames = new Map<string, string | null>()
  for (const c of runConversations) contactNames.set(c.id, c.contact.name)
  for (const c of conversations) contactNames.set(c.id, c.contact.name)

  return {
    start,
    end,
    conversations: facts,
    handoffRuns: runs.filter((r) => realRunIds.has(r.conversationId)),
    gaps: gaps.map((g) => ({
      id: g.id,
      conversationId: g.conversationId,
      messageId: g.messageId,
      contactName: g.conversation.contact.name,
      topic: g.topic,
      reason: g.reason,
      messageText: g.messageText,
    })),
    openGapTotal,
    contactNames,
  }
}
