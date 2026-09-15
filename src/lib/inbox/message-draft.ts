/**
 * Layanan draft jawaban per pesan (Task 3). Satu draft per pesan masuk (`MessageDraft.
 * sourceMessageId @unique`): agen bisa membuat, membuat ulang, mengedit, dan mengirimnya
 * sebagai balasan yang mengutip pesan sumber -- tidak pernah otomatis.
 *
 * `generateDraft` TIDAK PERNAH memanggil `sendMessage` maupun menulis `KnowledgeGapLog`: bot
 * dijalankan lewat `decideAndRespond(..., { draft: ... })` yang sudah memotong riwayat sebelum
 * pesan sumber dan mengumpulkan gap ke memori (`PendingKnowledgeGap[]`) alih-alih menulisnya.
 * Gap itu baru ditulis sungguhan oleh `sendDraft`, satu-satunya fungsi di sini yang benar-benar
 * mengirim sesuatu ke pelanggan.
 */
import { Prisma } from '@prisma/client'
import type { Message, MessageDraft } from '@prisma/client'
import { prisma } from '@/lib/db'
import { decideAndRespond, type PendingKnowledgeGap } from '@/lib/bot/orchestrator'
import { replyFromDecision } from '@/lib/bot-control/simulator'
import { sanitizeTrace } from '@/lib/bot-control/trace-sanitizer'
import { recordBotDecisionRun, attachMessageToDecisionRun } from '@/lib/bot-control/decision-recorder'
import { knowledgeGapsForDecision } from '@/lib/inbox/gap-signal'
import { recordUnsourcedReplyGap } from '@/lib/inbox/gap-log'
import { sendMessage } from '@/lib/send'
import { serializeMessage, type MessageView } from '@/lib/serialize-message'
import type { BotDecision } from '@/lib/bot/types'
import type { DraftKnowledgeGap, MessageDraftView } from './message-draft-view'

const SOURCE_NOT_FOUND = 'Pesan tidak ditemukan di percakapan ini'
const SOURCE_NOT_TEXT = 'Draft hanya bisa dibuat untuk pesan teks dari pelanggan'
const DRAFT_NOT_FOUND = 'Draft belum dibuat'
const DRAFT_LOCKED = 'Draft sudah terkirim dan terkunci'
const DRAFT_EMPTY = 'Draft kosong, tulis jawabannya dulu'

export class DraftError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    message: string
  ) {
    super(message)
    this.name = 'DraftError'
  }
}

const DRAFT_MODES = ['faq', 'booking_context', 'clarify', 'handoff'] as const

function isDraftMode(value: string): value is MessageDraftView['mode'] {
  return (DRAFT_MODES as readonly string[]).includes(value)
}

/** Pembacaan field longgar, sama seperti `asDecision` di decision-recorder.ts. */
function asRecord(value: unknown): { mode?: unknown; reason?: unknown } {
  return typeof value === 'object' && value !== null ? (value as { mode?: unknown; reason?: unknown }) : {}
}

/**
 * Penyempitan runtime MINIMAL sebelum menyerahkan Json yang tersimpan ke fungsi yang meminta
 * `BotDecision` (`knowledgeGapsForDecision`, `recordUnsourcedReplyGap`). Hanya memastikan
 * bentuknya sebuah object dengan `mode` bertipe string -- decision yang tersimpan selalu
 * berasal dari `decideAndRespond` sendiri lewat `generateDraft`, jadi ini penjaga terhadap baris
 * lama/rusak, bukan validasi skema penuh per varian.
 */
function asBotDecision(value: unknown): BotDecision | null {
  const record = asRecord(value)
  return typeof record.mode === 'string' ? (value as BotDecision) : null
}

/** `pendingKnowledgeGaps` dibaca balik dari Json dengan penyempitan runtime; baris rusak dibuang. */
function readPendingKnowledgeGaps(value: Prisma.JsonValue | null): PendingKnowledgeGap[] {
  if (!Array.isArray(value)) return []
  const gaps: PendingKnowledgeGap[] = []
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue
    const { topic, reason, messageText } = item as { topic?: unknown; reason?: unknown; messageText?: unknown }
    if (typeof topic !== 'string' || typeof messageText !== 'string') continue
    if (reason !== 'no_facts_resolved' && reason !== 'verification_failed') continue
    gaps.push({ topic, reason, messageText })
  }
  return gaps
}

async function loadSourceMessage(conversationId: string, messageId: string): Promise<Message> {
  const message = await prisma.message.findUnique({ where: { id: messageId } })
  if (!message || message.conversationId !== conversationId) throw new DraftError(404, SOURCE_NOT_FOUND)
  if (message.direction !== 'INBOUND' || !message.content?.trim()) throw new DraftError(400, SOURCE_NOT_TEXT)
  return message
}

async function loadDraftOrThrow(sourceMessageId: string): Promise<MessageDraft> {
  const draft = await prisma.messageDraft.findUnique({ where: { sourceMessageId } })
  if (!draft) throw new DraftError(404, DRAFT_NOT_FOUND)
  if (draft.sentAt) throw new DraftError(409, DRAFT_LOCKED)
  return draft
}

async function accountNamesFor(ids: Array<string | null | undefined>): Promise<Map<string, string>> {
  const uniqueIds = Array.from(new Set(ids.filter((id): id is string => Boolean(id))))
  if (uniqueIds.length === 0) return new Map()
  const accounts = await prisma.account.findMany({ where: { id: { in: uniqueIds } }, select: { id: true, name: true } })
  return new Map(accounts.map((account) => [account.id, account.name]))
}

function toView(draft: MessageDraft, sourceContent: string, names: Map<string, string>): MessageDraftView {
  const record = asRecord(draft.decision)
  const mode = typeof record.mode === 'string' && isDraftMode(record.mode) ? record.mode : 'handoff'
  const handoffReason = mode === 'handoff' && typeof record.reason === 'string' ? record.reason : null

  const decision = asBotDecision(draft.decision)
  const knowledgeGaps: DraftKnowledgeGap[] = decision
    ? knowledgeGapsForDecision(decision, sourceContent).map((gap) => ({ reason: gap.reason, missingQuestion: gap.missingQuestion }))
    : []
  for (const gap of readPendingKnowledgeGaps(draft.pendingKnowledgeGaps)) {
    knowledgeGaps.push({ reason: gap.reason, missingQuestion: null })
  }

  return {
    id: draft.id,
    sourceMessageId: draft.sourceMessageId,
    text: draft.text,
    generatedText: draft.generatedText,
    mode,
    handoffReason,
    decision: draft.decision,
    knowledgeGaps,
    generatedAt: draft.generatedAt.toISOString(),
    generatedByName: draft.generatedById ? (names.get(draft.generatedById) ?? null) : null,
    editedAt: draft.editedAt ? draft.editedAt.toISOString() : null,
    editedByName: draft.editedById ? (names.get(draft.editedById) ?? null) : null,
    sentAt: draft.sentAt ? draft.sentAt.toISOString() : null,
    sentByName: draft.sentById ? (names.get(draft.sentById) ?? null) : null,
    sentMessageId: draft.sentMessageId,
  }
}

async function buildView(draft: MessageDraft, sourceContent: string): Promise<MessageDraftView> {
  const names = await accountNamesFor([draft.generatedById, draft.editedById, draft.sentById])
  return toView(draft, sourceContent, names)
}

export async function generateDraft(input: { conversationId: string; messageId: string; accountId: string }): Promise<MessageDraftView> {
  const source = await loadSourceMessage(input.conversationId, input.messageId)
  const sourceContent = source.content ?? ''

  const existing = await prisma.messageDraft.findUnique({ where: { sourceMessageId: source.id } })
  if (existing?.sentAt) throw new DraftError(409, DRAFT_LOCKED)

  const startedAt = new Date()
  // Diisi OLEH `decideAndRespond` sendiri (lewat referensi ini) tepat di titik-titik yang
  // biasanya menulis KnowledgeGapLog langsung -- lihat header PendingKnowledgeGap di
  // orchestrator.ts. Generate draft tidak boleh punya efek samping ke data, jadi gap-nya
  // ditampung di sini dan baru ditulis sungguhan oleh `sendDraft`.
  const pendingKnowledgeGaps: PendingKnowledgeGap[] = []
  const decision = await decideAndRespond(input.conversationId, sourceContent, undefined, {
    draft: { historyBefore: source.createdAt, knowledgeGaps: pendingKnowledgeGaps },
  })
  const finishedAt = new Date()

  // `simulated: true` sama seperti Test Lab: giliran ini tidak boleh dihitung sebagai balasan
  // produksi di Decision Logs walau melewati orkestrator sungguhan.
  const decisionRunId = await recordBotDecisionRun({
    conversationId: input.conversationId,
    inboundText: sourceContent,
    decision,
    startedAt,
    finishedAt,
    simulated: true,
  })

  const generatedText = replyFromDecision(decision)
  const data = {
    generatedText,
    text: generatedText,
    decision: sanitizeTrace(decision) as Prisma.InputJsonValue,
    pendingKnowledgeGaps: pendingKnowledgeGaps as unknown as Prisma.InputJsonValue,
    decisionRunId,
    generatedById: input.accountId,
    generatedAt: finishedAt,
    // Generate (ulang) selalu membuang edit lama: teks yang ditampilkan kembali ke hasil
    // model, bukan revisi operator sebelumnya.
    editedAt: null,
    editedById: null,
  }

  // Penjaga balapan: draft yang sudah terkirim TIDAK BOLEH tertimpa oleh sebuah generate yang
  // baru saja selesai menghitung -- `existing` di atas hanya menangkap keadaan SAAT MULAI,
  // bukan saat model selesai berpikir.
  const claimed = await prisma.messageDraft.updateMany({ where: { sourceMessageId: source.id, sentAt: null }, data })

  let draft: MessageDraft
  if (claimed.count > 0) {
    draft = await prisma.messageDraft.findUniqueOrThrow({ where: { sourceMessageId: source.id } })
  } else {
    try {
      draft = await prisma.messageDraft.create({ data: { conversationId: input.conversationId, sourceMessageId: source.id, ...data } })
    } catch (error) {
      // Baris dibuat pemanggil lain di antara `existing` dan `create` ini (mis. dua klik
      // ganda) -- ulangi `updateMany` sekali, dan hanya sesudah itu nyatakan 409.
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error
      const retried = await prisma.messageDraft.updateMany({ where: { sourceMessageId: source.id, sentAt: null }, data })
      if (retried.count === 0) throw new DraftError(409, DRAFT_LOCKED)
      draft = await prisma.messageDraft.findUniqueOrThrow({ where: { sourceMessageId: source.id } })
    }
  }

  return buildView(draft, sourceContent)
}

export async function editDraft(input: {
  conversationId: string
  messageId: string
  accountId: string
  text: string
}): Promise<MessageDraftView> {
  const source = await loadSourceMessage(input.conversationId, input.messageId)
  const draft = await loadDraftOrThrow(source.id)

  // "Diedit" berarti berbeda dari apa yang model hasilkan -- kembali persis ke teks asli
  // (undo manual) melepas status "diedit" alih-alih membekukan sebuah edit kosong.
  const isEdited = input.text !== draft.generatedText
  const claimed = await prisma.messageDraft.updateMany({
    where: { id: draft.id, sentAt: null },
    data: { text: input.text, editedAt: isEdited ? new Date() : null, editedById: isEdited ? input.accountId : null },
  })
  if (claimed.count === 0) throw new DraftError(409, DRAFT_LOCKED)

  const fresh = await prisma.messageDraft.findUniqueOrThrow({ where: { id: draft.id } })
  return buildView(fresh, source.content ?? '')
}

export async function sendDraft(input: {
  conversationId: string
  messageId: string
  accountId: string
}): Promise<{ draft: MessageDraftView; message: MessageView }> {
  const source = await loadSourceMessage(input.conversationId, input.messageId)
  const draft = await loadDraftOrThrow(source.id)

  const text = (draft.text ?? '').trim()
  if (!text) throw new DraftError(400, DRAFT_EMPTY)

  // Klaim DULU, sebelum memanggil sendMessage: dua tekan "kirim" yang bersamaan tidak boleh
  // berdua-duanya lolos ke pelanggan. Pemenangnya ditentukan di sini oleh `sentAt: null`,
  // bukan oleh pembacaan `loadDraftOrThrow` di atas yang sudah basi begitu ada jeda I/O.
  const claimed = await prisma.messageDraft.updateMany({
    where: { id: draft.id, sentAt: null },
    data: { sentAt: new Date(), sentById: input.accountId },
  })
  if (claimed.count === 0) throw new DraftError(409, DRAFT_LOCKED)

  let sent: { id: string }
  try {
    sent = await sendMessage({
      conversationId: input.conversationId,
      text,
      sentBy: 'AGENT',
      agentId: input.accountId,
      replyToId: source.id,
      botTrace: draft.decision,
    })
  } catch (error) {
    // Klaim di atas sudah menulis sentAt -- sebuah pengiriman yang gagal TOTAL (melempar,
    // bukan sekadar deliveryStatus FAILED) harus mengembalikannya supaya agen bisa mencoba
    // lagi, bukan menemukan draft "terkirim" yang sebenarnya tidak pernah keluar.
    await prisma.messageDraft.update({ where: { id: draft.id }, data: { sentAt: null, sentById: null } })
    throw error
  }

  await prisma.messageDraft.update({ where: { id: draft.id }, data: { sentMessageId: sent.id } })
  await attachMessageToDecisionRun(draft.decisionRunId ?? null, sent.id)

  // Baru sekarang, SETELAH benar-benar terkirim, gap yang ditampung `generateDraft` ditulis
  // sungguhan -- satu per satu dalam try-nya sendiri, seperti gap-log.ts: satu baris yang
  // gagal tidak boleh ikut menggagalkan baris lain atau membatalkan pengiriman yang sudah terjadi.
  for (const gap of readPendingKnowledgeGaps(draft.pendingKnowledgeGaps)) {
    try {
      await prisma.knowledgeGapLog.create({
        data: { conversationId: input.conversationId, topic: gap.topic, reason: gap.reason, messageText: gap.messageText },
      })
    } catch (error) {
      console.error('sendDraft: gagal menulis pending knowledge gap', { conversationId: input.conversationId, error })
    }
  }

  // `recordUnsourcedReplyGap` sendiri tidak pernah melempar (lihat header gap-log.ts) --
  // dipanggil langsung, tanpa try/catch tambahan di sini.
  const decisionForGap = asBotDecision(draft.decision)
  if (decisionForGap) {
    await recordUnsourcedReplyGap({
      decision: decisionForGap,
      conversationId: input.conversationId,
      messageId: sent.id,
      runId: draft.decisionRunId ?? null,
      inboundText: source.content ?? '',
    })
  }

  const sentRow = await prisma.message.findUniqueOrThrow({ where: { id: sent.id }, include: { replyTo: true } })
  const finalDraft = await prisma.messageDraft.findUniqueOrThrow({ where: { id: draft.id } })

  return { draft: await buildView(finalDraft, source.content ?? ''), message: serializeMessage(sentRow) }
}

/** Untuk route daftar pesan (Task 4). */
export async function draftsForConversation(
  conversationId: string
): Promise<{ bySourceMessageId: Map<string, MessageDraftView>; sentMessageIds: Set<string> }> {
  const drafts = await prisma.messageDraft.findMany({ where: { conversationId } })
  if (drafts.length === 0) return { bySourceMessageId: new Map(), sentMessageIds: new Set() }

  const sourceMessages = await prisma.message.findMany({
    where: { id: { in: drafts.map((draft) => draft.sourceMessageId) } },
    select: { id: true, content: true },
  })
  const contentById = new Map(sourceMessages.map((message) => [message.id, message.content ?? '']))
  const names = await accountNamesFor(drafts.flatMap((draft) => [draft.generatedById, draft.editedById, draft.sentById]))

  const bySourceMessageId = new Map<string, MessageDraftView>()
  const sentMessageIds = new Set<string>()
  for (const draft of drafts) {
    bySourceMessageId.set(draft.sourceMessageId, toView(draft, contentById.get(draft.sourceMessageId) ?? '', names))
    if (draft.sentMessageId) sentMessageIds.add(draft.sentMessageId)
  }
  return { bySourceMessageId, sentMessageIds }
}
