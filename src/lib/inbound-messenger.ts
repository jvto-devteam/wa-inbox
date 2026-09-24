import { Prisma, type Platform } from '@prisma/client'
import { prisma } from '@/lib/db'
import { upsertChannelIdentity } from '@/lib/channel/identity'
import { defaultBotEnabled } from '@/lib/inbound'
import { broadcast } from '@/lib/realtime'
import { withMediaUrl } from '@/lib/serialize-message'
import type { MessengerMessagingEvent, MessengerWebhookPayload } from '@/lib/meta/messenger-types'

type MessengerAttachment = NonNullable<NonNullable<MessengerMessagingEvent['message']>['attachments']>[number]

/**
 * Ingest pesan Messenger dan Instagram DM.
 *
 * Satu fungsi untuk dua platform, dengan `platform` sebagai parameter, karena payload
 * keduanya identik: Meta memakai bentuk `entry[].messaging[]` yang sama untuk Page dan
 * Instagram. Memecahnya jadi dua file berarti dua tempat yang harus diperbaiki setiap kali
 * Meta mengubah bentuknya, dan dua tempat yang bisa berbeda diam-diam.
 */
export async function ingestMessengerPayload(
  payload: MessengerWebhookPayload,
  platform: Extract<Platform, 'FACEBOOK' | 'INSTAGRAM'>,
): Promise<{ processed: number; skipped: number }> {
  let processed = 0
  let skipped = 0

  for (const entry of payload.entry ?? []) {
    for (const event of entry.messaging ?? []) {
      if (await ingestOne(event, platform)) processed += 1
      else skipped += 1
    }
  }

  return { processed, skipped }
}

/**
 * Penanda dapat-dibaca-manusia untuk pesan tanpa teks tapi punya lampiran (foto, stiker,
 * dll). Media-nya sendiri SENGAJA tidak diunduh atau disimpan di sini -- URL Meta
 * kedaluwarsa ~5 menit dan butuh header Authorization untuk diresolve ulang (lihat komentar
 * `mediaId` di prisma/schema.prisma); itu pekerjaan tersendiri, di luar cakupan ini. Yang
 * harus terjadi sekarang hanyalah: percakapan MUNCUL di Inbox dan operator TAHU pelanggan
 * menulis sesuatu, lalu bisa membukanya langsung di Messenger untuk melihat isi aslinya.
 * Tanpa penanda ini, pesan berlampiran-tanpa-teks menghasilkan nol jejak sama sekali --
 * tidak ada Message, tidak ada Conversation, tidak ada broadcast -- persis pola "gagal
 * diam-diam" yang seluruh rencana omnichannel ini menolaknya di setiap keputusan lain.
 */
function attachmentPlaceholder(attachments: MessengerAttachment[] | undefined): string | null {
  if (!attachments || attachments.length === 0) return null
  const type = attachments[0]?.type
  return type ? `[Lampiran: ${type}]` : '[Lampiran]'
}

async function ingestOne(
  event: MessengerMessagingEvent,
  platform: Extract<Platform, 'FACEBOOK' | 'INSTAGRAM'>,
): Promise<boolean> {
  const message = event.message
  if (!message) return false

  // Echo adalah salinan pesan yang kita kirim sendiri, dipantulkan Meta. Memprosesnya
  // sebagai pesan masuk membuat bot menjawab dirinya sendiri.
  if (message.is_echo) return false

  const text = message.text?.trim()
  // Teks lebih diutamakan; kalau kosong, jatuh ke penanda lampiran. Event yang benar-benar
  // kosong (tanpa teks DAN tanpa lampiran) tidak membawa apa pun untuk dicatat -- itu bukan
  // kegagalan, hanya memang tidak ada isi.
  const content = text || attachmentPlaceholder(message.attachments)
  if (!content) return false

  const existing = await prisma.message.findUnique({ where: { externalId: message.mid } })
  if (existing) return false

  // Identitas dicari LEBIH DULU, Contact dibuat hanya kalau belum ada -- pola yang sama
  // persis dengan ingestSingleMessage di src/lib/inbound.ts. Kalau Contact dibuat tanpa
  // syarat, pelanggan yang sama mengirim 50 pesan meninggalkan 49 baris Contact yatim:
  // percakapannya tetap benar (ia memakai identity.contactId), tapi sampahnya menumpuk
  // di tier 1 halaman Kontak -- tempat yang justru disediakan untuk kontak tanpa percakapan.
  const known = await prisma.channelIdentity.findUnique({
    where: { platform_externalId: { platform, externalId: event.sender.id } },
    select: { contactId: true },
  })

  const contactId =
    known?.contactId ?? (await prisma.contact.create({ data: { phone: null, name: null } })).id

  const identity = await upsertChannelIdentity({
    platform,
    externalId: event.sender.id,
    contactId,
  })

  const sentAt = new Date(event.timestamp)

  const conversation = await prisma.conversation.upsert({
    where: {
      channelIdentityId_externalThreadId: { channelIdentityId: identity.id, externalThreadId: '' },
    },
    update: { lastMessageAt: sentAt },
    create: {
      contactId: identity.contactId,
      channelIdentityId: identity.id,
      externalThreadId: '',
      lastMessageAt: sentAt,
      botEnabled: await defaultBotEnabled({ platform, phone: null }),
    },
  })

  try {
    const created = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        externalId: message.mid,
        direction: 'INBOUND',
        type: 'text',
        content,
        channel: 'OFFICIAL',
        sentBy: 'CUSTOMER',
      },
    })

    // Bentuk event mengikuti apa yang benar-benar dipakai src/lib/inbound.ts
    // (ingestSingleMessage), bukan bentuk yang dikarang baru: RealtimeEvent di
    // src/lib/realtime.ts tidak punya varian 'message.new', dan 'message.created' wajib
    // membawa `message` supaya ConversationList/ThreadView bisa merender bubble-nya tanpa
    // fetch ulang.
    broadcast({ type: 'message.created', conversationId: conversation.id, message: withMediaUrl(created) })
    return true
  } catch (error) {
    // Balapan retry-at-least-once Meta yang sama seperti ingestSingleMessage di
    // src/lib/inbound.ts: dua pengiriman webhook `mid` yang sama, keduanya lolos findUnique
    // di atas sebelum salah satu message.create() commit. Constraint @unique pada
    // externalId menahan baris duplikat di level DB -- sisi yang kalah balapan harus
    // melapor skip bersih, bukan melempar keluar dari loop ingestMessengerPayload dan
    // membatalkan sisa pesan di payload webhook itu.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return false
    }
    throw error
  }
}
