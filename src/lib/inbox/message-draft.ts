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
const DRAFT_STALE = 'Draft baru saja berubah, muat ulang lalu kirim lagi'

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
  // `type !== 'text'` juga ditolak di sini, bukan hanya `!content` -- gambar/video/dokumen
  // berkaption punya `content` terisi (Meta mengirim caption sebagai content), tapi bot
  // sungguhan tidak pernah menjawabnya (lihat inbound.ts: hanya `type === 'text'` yang lewat
  // gerbang bot). Membiarkan draft dibuat untuk pesan macam ini akan menjawab sesuatu yang
  // bot produksi tidak pernah benar-benar diminta menjawab.
  if (message.direction !== 'INBOUND' || message.type !== 'text' || !message.content?.trim()) {
    throw new DraftError(400, SOURCE_NOT_TEXT)
  }
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
  //
  // `updatedAt: draft.updatedAt` di where-clause -- bukan cuma `sentAt: null` -- menutup
  // celah yang lebih halus: sebuah generate-ulang/edit yang menyelip TEPAT di antara
  // `loadDraftOrThrow` di atas dan klaim ini mengubah `text` (dan Prisma membumbui `updatedAt`
  // baru lewat `@updatedAt`) tanpa mengubah `sentAt`. Tanpa penjaga ini klaim tetap lolos dan
  // `text`/`decision`/dll yang dipakai di bawah adalah versi BASI -- pelanggan menerima jawaban
  // lama sementara baris di DB sudah menunjukkan draft yang baru.
  const sentAt = new Date()
  const claimed = await prisma.messageDraft.updateMany({
    where: { id: draft.id, sentAt: null, updatedAt: draft.updatedAt },
    data: { sentAt, sentById: input.accountId },
  })
  if (claimed.count === 0) {
    // Klaim gagal karena salah satu dari dua hal, dan keduanya butuh pesan berbeda: draft
    // sudah keburu terkirim (lewat request lain) -> tetap "terkunci"; atau draft masih belum
    // terkirim tapi `updatedAt`-nya sudah berubah (edit/regenerate menyelip) -> "berubah",
    // bukan "terkunci", supaya agen tahu harus muat ulang teksnya, bukan menganggap orang lain
    // sudah mengirimkannya.
    const fresh = await prisma.messageDraft.findUnique({ where: { id: draft.id } })
    throw new DraftError(409, fresh?.sentAt ? DRAFT_LOCKED : DRAFT_STALE)
  }

  let sent: Awaited<ReturnType<typeof sendMessage>>
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
    //
    // Rollback ini sendiri bisa gagal (DB berkedip lagi tepat di titik ini) -- kalau dibiarkan
    // melempar, error ASLI dari `sendMessage` (alasan sebenarnya kenapa pengiriman gagal)
    // tertutup oleh error rollback, dan draft tertinggal terkunci (sentAt masih terisi) tanpa
    // agen pernah tahu kenapa. Log-dan-lanjut di sini, lalu tetap lempar error ASLI supaya
    // pemanggil melihat sebab kegagalan yang sebenarnya.
    try {
      await prisma.messageDraft.update({ where: { id: draft.id }, data: { sentAt: null, sentById: null } })
    } catch (rollbackError) {
      console.error('sendDraft: gagal mengembalikan klaim draft setelah sendMessage gagal', {
        conversationId: input.conversationId,
        error: rollbackError,
      })
    }
    throw error
  }

  // TITIK TANPA JALAN BALIK: `sendMessage` sudah mengembalikan sebuah baris, yang berarti
  // pesan SUDAH keluar ke pelanggan -- lepas dari `deliveryStatus` akhirnya (bubble-nya sendiri
  // yang menunjukkan status pengiriman, lihat send.ts). Dari titik ini, TIDAK SATU PUN langkah
  // di bawah boleh membuat `sendDraft` melempar lagi: setiap langkah adalah pembukuan pasca-
  // kirim (menautkan id, mencatat gap), bukan syarat sebuah pengiriman dianggap berhasil.
  // Sebuah tulisan pembukuan yang gagal di sini dulu membuat route membalas 500 "Gagal
  // mengirim draft" padahal pesannya sudah terkirim -- agen yang membaca "gagal" mengetik
  // ulang lewat composer dan pelanggan menerima dua kali. Setiap langkah karena itu log-dan-
  // lanjut sendiri-sendiri, dan gap TETAP ditulis walau langkah sebelumnya gagal.
  try {
    await prisma.messageDraft.update({ where: { id: draft.id }, data: { sentMessageId: sent.id } })
  } catch (error) {
    console.error('sendDraft: gagal menyimpan sentMessageId (pesan tetap terkirim)', { conversationId: input.conversationId, error })
  }

  try {
    await attachMessageToDecisionRun(draft.decisionRunId ?? null, sent.id)
  } catch (error) {
    console.error('sendDraft: gagal menautkan run keputusan (pesan tetap terkirim)', { conversationId: input.conversationId, error })
  }

  // Gap yang ditampung `generateDraft` ditulis sungguhan -- satu per satu dalam try-nya
  // sendiri, seperti gap-log.ts: satu baris yang gagal tidak boleh ikut menggagalkan baris
  // lain, dan TIDAK bergantung pada langkah sentMessageId di atas berhasil atau tidak.
  for (const gap of readPendingKnowledgeGaps(draft.pendingKnowledgeGaps)) {
    try {
      await prisma.knowledgeGapLog.create({
        data: { conversationId: input.conversationId, topic: gap.topic, reason: gap.reason, messageText: gap.messageText },
      })
    } catch (error) {
      console.error('sendDraft: gagal menulis pending knowledge gap (pesan tetap terkirim)', { conversationId: input.conversationId, error })
    }
  }

  // `recordUnsourcedReplyGap` sendiri sudah tidak pernah melempar (lihat header gap-log.ts),
  // tapi dibungkus juga di sini supaya kegagalan tak terduga apa pun tetap log-dan-lanjut,
  // konsisten dengan setiap langkah pasca-kirim lain di atas.
  const decisionForGap = asBotDecision(draft.decision)
  if (decisionForGap) {
    try {
      await recordUnsourcedReplyGap({
        decision: decisionForGap,
        conversationId: input.conversationId,
        messageId: sent.id,
        runId: draft.decisionRunId ?? null,
        inboundText: source.content ?? '',
      })
    } catch (error) {
      console.error('sendDraft: gagal mencatat gap balasan (pesan tetap terkirim)', { conversationId: input.conversationId, error })
    }
  }

  // Dibangun dari data yang SUDAH ADA di memori (baris `sent` yang dikembalikan `sendMessage`,
  // yang sudah menyertakan `replyTo`; dan `draft` yang sudah diketahui + status kirim yang baru
  // saja diklaim) -- bukan dibaca ulang lewat `findUniqueOrThrow`. Sebuah pembacaan ulang yang
  // gagal (mis. DB berkedip sepersekian detik) tidak boleh mengubah "pesan sudah terkirim"
  // menjadi respons 500.
  const names = await accountNamesFor([draft.generatedById, draft.editedById, input.accountId]).catch((error: unknown) => {
    console.error('sendDraft: gagal mengambil nama akun (pesan tetap terkirim)', { conversationId: input.conversationId, error })
    return new Map<string, string>()
  })
  const finalDraft: MessageDraft = { ...draft, sentAt, sentById: input.accountId, sentMessageId: sent.id }

  return { draft: toView(finalDraft, source.content ?? '', names), message: serializeMessage(sent) }
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
