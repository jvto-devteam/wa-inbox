import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { broadcast } from '@/lib/realtime'
import { withMediaUrl } from '@/lib/serialize-message'
import type { OutboundMedia } from '@/lib/send'
import { getAccessToken, gmailGetMessageHeaders, gmailSendRaw } from './client'
import { GmailError } from './errors'
import { buildReplyMime, replySubject } from './mime'

export interface EmailSendParams {
  conversationId: string
  text: string
  sentBy: 'AGENT' | 'BOT'
  agentId?: string
  replyToId?: string
  media?: OutboundMedia
}

/**
 * Jalur kirim EMAIL (spec §7): Gmail messages.send, threadId dipertahankan, FROM = kotak surat
 * yang disurati (spec §4.3). Balasan ikut masuk folder Sent Gmail -- siapa pun yang membuka
 * Gmail melihat percakapan yang sama.
 *
 * Baris Message dibuat PENDING SEBELUM panggilan Gmail, berbeda dengan jalur Messenger, karena
 * id-nya harus sudah ada untuk dipasang sebagai header X-WA-Inbox-Id. Dari header itulah
 * sinkronisasi (src/lib/gmail/ingest.ts) mengenali salinan SENT sebagai milik kita dan tidak
 * mencatatnya dua kali.
 */
export async function sendEmailMessage(params: EmailSendParams, botTrace: Prisma.InputJsonValue | undefined) {
  const base = {
    conversationId: params.conversationId,
    direction: 'OUTBOUND' as const,
    type: 'text',
    channel: 'OFFICIAL' as const,
    sentBy: params.sentBy,
    agentId: params.agentId,
    botTrace: botTrace as never,
    replyToId: params.replyToId,
  }

  const recordFailed = async (content: string | null) => {
    const failed = await prisma.message.create({ data: { ...base, content, deliveryStatus: 'FAILED' }, include: { replyTo: true } })
    broadcast({ type: 'message.created', conversationId: params.conversationId, message: withMediaUrl(failed) })
    return failed
  }

  // Keputusan D9, sama dengan jalur Messenger: gagal TERLIHAT, bukan diam-diam mengirim teksnya
  // saja dan kehilangan lampirannya.
  if (params.media) {
    return recordFailed('Kirim lampiran lewat email belum didukung -- kirim teks, atau balas lewat Gmail')
  }

  const conversation = await prisma.conversation.findUniqueOrThrow({
    where: { id: params.conversationId },
    select: {
      externalThreadId: true,
      subject: true,
      channelIdentity: { select: { externalId: true } },
      mailAccount: { select: { id: true, emailAddress: true, refreshToken: true } },
    },
  })
  const to = conversation.channelIdentity?.externalId
  const account = conversation.mailAccount
  if (!to || !account || !conversation.externalThreadId) {
    console.error('sendEmailMessage: percakapan email tanpa penerima, kotak surat, atau thread', { conversationId: params.conversationId })
    return recordFailed(params.text || null)
  }

  const pending = await prisma.message.create({
    data: { ...base, content: params.text || null, deliveryStatus: 'PENDING' },
    include: { replyTo: true },
  })
  broadcast({ type: 'message.created', conversationId: params.conversationId, message: withMediaUrl(pending) })

  let externalId: string | undefined
  let deliveryStatus: 'SENT' | 'FAILED' = 'SENT'
  try {
    const token = await getAccessToken(account)
    const anchor = await prisma.message.findFirst({
      where: { conversationId: params.conversationId, externalId: { not: null }, id: { not: pending.id } },
      orderBy: { createdAt: 'desc' },
      select: { externalId: true },
    })
    const headers = anchor?.externalId
      ? await gmailGetMessageHeaders(token, anchor.externalId, ['Message-ID', 'References', 'Subject'])
      : {}
    const raw = buildReplyMime({
      from: account.emailAddress,
      to,
      subject: replySubject(headers.subject ?? conversation.subject),
      inReplyTo: headers['message-id'] ?? null,
      references: headers.references ?? null,
      waInboxId: pending.id,
      text: params.text,
    })
    externalId = (await gmailSendRaw(token, raw, conversation.externalThreadId)).id
  } catch (error) {
    console.error('sendEmailMessage: pengiriman gagal', {
      conversationId: params.conversationId, kind: error instanceof GmailError ? error.kind : 'unknown',
    })
    deliveryStatus = 'FAILED'
  }

  let updated
  if (externalId) {
    updated = await prisma.message.update({
      where: { id: pending.id },
      data: { deliveryStatus, externalId },
      include: { replyTo: true },
    })
  } else {
    // Fix round 1 (Temuan 1b): deliveryStatus di sini adalah 'FAILED', tapi jawaban
    // messages.send yang gagal ditangkap tidak berarti Gmail-nya gagal mengirim -- 5xx bisa
    // muncul SETELAH Gmail menerima pesannya, koneksi bisa putus setelah itu, fetch bisa
    // timeout. Salinan SENT dari email itu bisa sudah tersinkron balik dan direkonsiliasi
    // ingest.ts (src/lib/gmail/ingest.ts) SEBELUM baris ini sampai di sini. updateMany
    // berpenjaga externalId: null supaya update ini TIDAK PERNAH menimpa baris yang sudah
    // SENT kembali jadi FAILED -- itu yang membuat operator menekan retry dan pelanggan
    // menerima email yang sama dua kali.
    await prisma.message.updateMany({ where: { id: pending.id, externalId: null }, data: { deliveryStatus: 'FAILED' } })
    updated = await prisma.message.findUniqueOrThrow({ where: { id: pending.id }, include: { replyTo: true } })
  }
  broadcast({ type: 'message.updated', conversationId: params.conversationId, message: withMediaUrl(updated) })
  return updated
}
