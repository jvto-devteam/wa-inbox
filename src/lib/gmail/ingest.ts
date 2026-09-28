import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { upsertChannelIdentity } from '@/lib/channel/identity'
import { broadcast } from '@/lib/realtime'
import { withMediaUrl } from '@/lib/serialize-message'
import { cleanEmailBody } from './clean-body'
import { parseGmailMessage, type EmailAddress, type ParsedEmail } from './parse'
import type { GmailMessage } from './types'

/**
 * Satu email Gmail -> satu Message di benangnya.
 *
 * TIDAK ADA jalur bot di sini, dan itu disengaja (spec §2, §11): bot di email hanya membuat
 * draf yang ditekan operator (src/lib/inbox/message-draft.ts). Percakapan email lahir dengan
 * botEnabled: false, tanpa membaca Settings -- tidak ada sakelar yang bisa menyalakannya.
 */
export type IngestOutcome = 'created' | 'reconciled' | 'skipped'

/**
 * Vonis GMAIL sendiri, bukan penyaring buatan kita (keputusan D2). Kategori Promosi/Sosial/
 * Update sengaja TIDAK ada di sini: semua email masuk, pelabelan urusan fase 3b.
 */
const SKIP_LABELS = new Set(['SPAM', 'TRASH', 'DRAFT', 'CHAT'])

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

function composeContent(email: ParsedEmail): string {
  const body = cleanEmailBody(email.body)
  const attachments = email.attachments.map((name) => `[Lampiran: ${name}]`).join('\n')
  return [body, attachments].filter(Boolean).join('\n\n') || '(email tanpa isi)'
}

export async function ingestGmailMessage(account: { id: string; emailAddress: string }, message: GmailMessage): Promise<IngestOutcome> {
  const email = parseGmailMessage(message)
  if (email.labelIds.some((label) => SKIP_LABELS.has(label))) return 'skipped'

  const existing = await prisma.message.findUnique({ where: { externalId: email.id }, select: { id: true } })
  if (existing) return 'skipped'

  const content = composeContent(email)

  // Label SENT dipasang Gmail sendiri; From bisa dipalsukan siapa saja. Arah pesan karena itu
  // ditentukan label, bukan header.
  if (email.labelIds.includes('SENT')) return ingestOutbound(account, email, content)

  if (!email.from) {
    console.warn('ingestGmailMessage: email tanpa alamat pengirim yang bisa dibalas', { gmailMessageId: email.id })
    return 'skipped'
  }
  // Tanpa label SENT tapi "dari" kotak surat ini sendiri: catatan untuk diri sendiri, atau
  // pemalsuan From. Bukan pelanggan -- jangan lahirkan kontak ber-alamat JVTO.
  if (email.from.address === account.emailAddress) return 'skipped'

  const conversationId = await findOrCreateThread(account, email, email.from)
  return createMessage(conversationId, email, content, 'INBOUND')
}

async function ingestOutbound(account: { id: string }, email: ParsedEmail, content: string): Promise<IngestOutcome> {
  // Salinan SENT dari balasan yang dikirim wa-inbox sendiri (src/lib/gmail/send.ts menandainya
  // dengan X-WA-Inbox-Id). Barisnya sudah ada; cukup pastikan externalId-nya terisi, karena
  // sinkronisasi bisa tiba lebih dulu daripada jawaban messages.send.
  if (email.waInboxId) {
    const own = await prisma.message.findUnique({ where: { id: email.waInboxId }, select: { id: true, externalId: true } })
    if (own) {
      if (!own.externalId) await prisma.message.update({ where: { id: own.id }, data: { externalId: email.id } })
      return 'reconciled'
    }
  }

  // Balasan yang diketik admin langsung di Gmail web. Dicatat hanya kalau benangnya sudah ada
  // di Inbox (keputusan D4) -- email yang dibuka JVTO muncul begitu pelanggan membalas.
  const conversation = await prisma.conversation.findFirst({
    where: { mailAccountId: account.id, externalThreadId: email.threadId },
    select: { id: true },
  })
  if (!conversation) return 'skipped'
  return createMessage(conversation.id, email, content, 'OUTBOUND')
}

async function findOrCreateThread(account: { id: string }, email: ParsedEmail, from: EmailAddress): Promise<string> {
  // Benang dicari lewat (kotak surat, thread Gmail) LEBIH DULU, siapa pun pengirimnya: orang
  // kedua yang ikut membalas di thread yang sama harus masuk benang yang sama.
  const byThread = await prisma.conversation.findFirst({
    where: { mailAccountId: account.id, externalThreadId: email.threadId },
    select: { id: true },
  })
  if (byThread) return byThread.id

  // Identitas dulu, Contact hanya kalau identitasnya baru -- pola yang sama dengan
  // src/lib/inbound-messenger.ts, supaya pelanggan yang menulis 50 email tidak meninggalkan
  // 49 Contact yatim.
  const known = await prisma.channelIdentity.findUnique({
    where: { platform_externalId: { platform: 'EMAIL', externalId: from.address } },
    select: { contactId: true },
  })
  const contactId = known?.contactId ?? (await prisma.contact.create({ data: { phone: null, name: from.name } })).id
  const identity = await upsertChannelIdentity({
    platform: 'EMAIL',
    externalId: from.address,
    contactId,
    displayName: from.name ?? undefined,
  })

  try {
    const conversation = await prisma.conversation.upsert({
      where: { channelIdentityId_externalThreadId: { channelIdentityId: identity.id, externalThreadId: email.threadId } },
      update: {},
      create: {
        contactId: identity.contactId,
        channelIdentityId: identity.id,
        externalThreadId: email.threadId,
        mailAccountId: account.id,
        subject: email.subject,
        lastMessageAt: email.sentAt,
        botEnabled: false,
      },
      select: { id: true },
    })
    return conversation.id
  } catch (error) {
    // Dua peserta berbeda membalas thread baru yang sama nyaris bersamaan: yang kalah menabrak
    // @@unique([mailAccountId, externalThreadId]). Benangnya sudah ada -- pakai yang menang.
    if (isUniqueViolation(error)) {
      const winner = await prisma.conversation.findFirst({
        where: { mailAccountId: account.id, externalThreadId: email.threadId },
        select: { id: true },
      })
      if (winner) return winner.id
    }
    throw error
  }
}

async function createMessage(
  conversationId: string,
  email: ParsedEmail,
  content: string,
  direction: 'INBOUND' | 'OUTBOUND',
): Promise<IngestOutcome> {
  try {
    const created = await prisma.message.create({
      data: {
        conversationId,
        externalId: email.id,
        direction,
        type: 'text',
        content,
        channel: 'OFFICIAL',
        sentBy: direction === 'INBOUND' ? 'CUSTOMER' : 'AGENT',
        ...(direction === 'OUTBOUND' ? { deliveryStatus: 'SENT' as const } : {}),
        // Waktu Gmail, bukan waktu sinkronisasi: pemulihan 7 hari (sync.ts) menarik email lama,
        // dan email lama yang tercatat "baru saja" merusak urutan benangnya.
        createdAt: email.sentAt,
      },
    })
    // Hanya MAJU: email lama dari pemulihan tidak boleh memundurkan urutan sidebar.
    await prisma.conversation.updateMany({
      where: { id: conversationId, lastMessageAt: { lt: email.sentAt } },
      data: { lastMessageAt: email.sentAt },
    })
    broadcast({ type: 'message.created', conversationId, message: withMediaUrl(created) })
    return 'created'
  } catch (error) {
    // Push dan cron memproses email yang sama bersamaan; @unique externalId menahan duplikat.
    if (isUniqueViolation(error)) return 'skipped'
    throw error
  }
}
