import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { resolveMetaMediaUrl, downloadMetaMedia } from '@/lib/meta/media'

/**
 * Streams an inbound media message's bytes on demand. Meta's media URLs expire
 * within minutes of being issued, so nothing is cached here -- every request
 * re-resolves Message.mediaId through the Graph API and re-downloads. This route
 * sits behind the global session middleware (src/middleware.ts), so only signed-in
 * agents/admins can ever reach it.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ messageId: string }> }) {
  const { messageId } = await params
  const message = await prisma.message.findUnique({ where: { id: messageId } })
  if (!message || !message.mediaId) {
    return NextResponse.json({ error: 'Media tidak ditemukan' }, { status: 404 })
  }

  const waNumber = await prisma.waNumber.findFirst()
  if (!waNumber) {
    return NextResponse.json({ error: 'Nomor WhatsApp belum dikonfigurasi' }, { status: 500 })
  }

  try {
    const { url, mimeType } = await resolveMetaMediaUrl(message.mediaId, waNumber.accessToken)
    const mediaRes = await downloadMetaMedia(url, waNumber.accessToken)
    if (!mediaRes.ok) {
      return NextResponse.json({ error: 'Gagal mengambil media dari Meta' }, { status: 502 })
    }

    const buffer = await mediaRes.arrayBuffer()
    const headers: Record<string, string> = { 'Content-Type': message.mimeType ?? mimeType }
    if (message.fileName) headers['Content-Disposition'] = `inline; filename="${message.fileName}"`

    return new Response(buffer, { headers })
  } catch (error) {
    console.error('media proxy: failed to resolve/download Meta media', { messageId, error })
    return NextResponse.json({ error: 'Gagal mengambil media dari Meta' }, { status: 502 })
  }
}
