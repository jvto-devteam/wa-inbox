import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { resolveChannelContact, type ChannelIdentityInput } from '@/lib/channel/contact-channel'

/**
 * GET /api/conversations/[id]/channel — info kontak di platform asal untuk panel kanan Inbox:
 * nomor WhatsApp, alamat email, @username Instagram, atau nama Facebook, beserta tautannya.
 *
 * Endpoint tersendiri, bukan field di GET /api/conversations/[id]: untuk IG/FB ia bisa memanggil
 * Graph API (timeout 5 dtk), dan itu tidak boleh memperlambat pembukaan thread. Panel memuatnya
 * terpisah dan tetap tampil lebih dulu tanpa bagian ini.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const conversation = await prisma.conversation.findUnique({
      where: { id },
      select: {
        channelIdentity: { select: { platform: true, externalId: true, displayName: true } },
        contact: { select: { phone: true } },
      },
    })
    if (!conversation) return NextResponse.json({ error: 'Percakapan tidak ditemukan' }, { status: 404 })

    // Baris pra-fondasi tanpa ChannelIdentity adalah WhatsApp -- sama dengan cara sendMessage
    // (src/lib/send.ts) memperlakukannya.
    const identity: ChannelIdentityInput | null =
      conversation.channelIdentity ??
      (conversation.contact.phone ? { platform: 'WHATSAPP', externalId: conversation.contact.phone, displayName: null } : null)

    return NextResponse.json({ contact: identity ? await resolveChannelContact(identity) : null })
  } catch {
    return NextResponse.json({ error: 'Gagal memuat info kontak' }, { status: 500 })
  }
}
