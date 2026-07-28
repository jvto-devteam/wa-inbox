import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { mkdir, writeFile } from 'fs/promises'
import path from 'path'

// Meta's own per-type caps (Cloud API media messages) -- enforcing the same limits here
// gives the agent an immediate, specific error instead of a confusing failure once the file
// reaches uploadMetaMediaFromUrl/sendCoexistMedia downstream.
const MAX_BYTES: Record<'image' | 'video' | 'audio' | 'document', number> = {
  image: 5 * 1024 * 1024,
  video: 16 * 1024 * 1024,
  audio: 16 * 1024 * 1024,
  document: 100 * 1024 * 1024,
}

function mediaTypeFromMime(mime: string): 'image' | 'video' | 'audio' | 'document' | null {
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  // Anything else sendable at all (pdf, office docs, plain text, ...) rides as a
  // WhatsApp "document" -- the same bucket Meta itself uses for non-image/video/audio files.
  if (mime) return 'document'
  return null
}

/**
 * Stores an agent's outbound attachment on local disk under `public/uploads`, served directly
 * by Next.js at request time (this app has no object-storage integration), and returns a
 * public URL. Both send paths need a real fetchable URL for the file, not raw bytes: Meta's
 * Media API is reached by first downloading from a URL (see uploadMetaMediaFromUrl), and
 * wa-coexist's send_image_url/send_file_url endpoints fetch the URL themselves.
 */
export async function POST(req: Request) {
  const form = await req.formData()
  const file = form.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'File wajib diisi' }, { status: 400 })

  const mediaType = mediaTypeFromMime(file.type)
  if (!mediaType) return NextResponse.json({ error: 'Jenis file tidak didukung' }, { status: 400 })

  const cap = MAX_BYTES[mediaType]
  if (file.size > cap) {
    return NextResponse.json(
      { error: `Ukuran file melebihi batas ${Math.round(cap / (1024 * 1024))}MB untuk ${mediaType}` },
      { status: 400 }
    )
  }

  const uploadsDir = path.join(process.cwd(), 'public', 'uploads')
  await mkdir(uploadsDir, { recursive: true })
  const storedName = `${randomUUID()}${path.extname(file.name)}`
  await writeFile(path.join(uploadsDir, storedName), Buffer.from(await file.arrayBuffer()))

  // APP_BASE_URL, not a relative path: both Meta and wa-coexist fetch this URL themselves
  // (from Meta's servers / from wa-coexist's own process), so it must resolve on the public
  // internet, not just inside this Next.js server.
  const baseUrl = process.env.APP_BASE_URL ?? ''
  return NextResponse.json({
    url: `${baseUrl}/uploads/${storedName}`,
    type: mediaType,
    mimeType: file.type,
    fileName: file.name,
  })
}
