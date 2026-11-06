import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { authenticateApiClient } from '@/lib/api-clients/auth'
import { prisma } from '@/lib/db'
import { CREW_NOTE_SECTIONS, type CrewNote, type CrewNoteSection } from '@/lib/daily-summary/payload-schema'
import { isUnsafeForCrew } from '@/lib/chat-review/crew-note'
import { crewNoteOf } from '@/lib/chat-review/store'
import { redactText } from '@/lib/summaries/digest'

/**
 * GET /api/v1/booking-brief?ref=<nomor booking> -- Catatan untuk crew (Guest Brief) satu booking, dibaca crew-portal
 * (aplikasi crew) dari sisi SERVER; key tidak pernah sampai ke peramban.
 *
 *   Authorization: Bearer wai_...
 *
 * `ref` = nomor booking backoffice: `bookings.booking_code` (JVTO, mis. JVR/012/11/26) atau `invoice_code_origin`
 * (Klook/TWT), yaitu isi `Conversation.bookingData.booking_number` atau `.id`. Isinya SATU sumber dengan bagian
 * "Catatan untuk crew" di panel Inbox: `chatReview.catatanCrew` (`chat-review/crew-note.ts`).
 *
 * Akses seperti /api/v1/summaries: key `wai_` DITAMBAH daftar baca khusus `BOOKING_BRIEF_READ_CLIENT_IDS` (env kosong =
 * tertutup, 403), supaya key pengirim pesan dan key Operator tidak ikut bisa membaca catatan crew. Middleware hanya
 * meloloskan path ini bila ada Bearer key; selebihnya urusan handler ini.
 *
 * Selain disaring saat dibuat, isi disaring SEKALI LAGI di sini (nominal, kata pembayaran, telepon, email): catatan lama
 * atau yang tersimpan sebelum aturan berubah tidak boleh bocor ke crew. 404 untuk "tidak ada percakapan", "belum ada
 * catatan", dan catatan kosong sekaligus: crew-portal cukup tidak menampilkan kartu.
 */
const READ_CLIENTS_ENV = 'BOOKING_BRIEF_READ_CLIENT_IDS'

const querySchema = z.object({
  ref: z
    .string()
    .trim()
    .min(3)
    .max(64)
    .regex(/^[A-Za-z0-9/_.\- ]+$/),
})

function allowedClientIds(): Set<string> {
  return new Set(
    (process.env[READ_CLIENTS_ENV] ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  )
}

export type BookingBriefResponse = {
  ref: string
  diperbaruiAt: string
  /** Hanya bagian yang berisi, urut sesuai `CREW_NOTE_SECTIONS`. */
  bagian: { kunci: CrewNoteSection; baris: string[] }[]
}

function safeSections(note: CrewNote): BookingBriefResponse['bagian'] {
  const out: BookingBriefResponse['bagian'] = []
  for (const kunci of CREW_NOTE_SECTIONS) {
    const baris = note[kunci].map((l) => redactText(l)).filter((l) => !isUnsafeForCrew(l))
    if (baris.length > 0) out.push({ kunci, baris })
  }
  return out
}

export async function GET(req: Request) {
  try {
    const client = await authenticateApiClient(req)
    if (!client) return NextResponse.json({ error: 'API key tidak valid' }, { status: 401 })
    if (!allowedClientIds().has(client.id)) {
      return NextResponse.json({ error: 'API key ini tidak punya akses baca catatan crew' }, { status: 403 })
    }

    const parsed = querySchema.safeParse({ ref: new URL(req.url).searchParams.get('ref') ?? undefined })
    if (!parsed.success) return NextResponse.json({ error: 'Parameter ref wajib dan berformat nomor booking' }, { status: 400 })
    const ref = parsed.data.ref

    // Beberapa percakapan bisa memegang booking yang sama; yang ringkasannya terbaru menang.
    const conversations = await prisma.conversation.findMany({
      where: {
        chatReview: { not: Prisma.DbNull },
        OR: [{ bookingData: { path: ['booking_number'], equals: ref } }, { bookingData: { path: ['id'], equals: ref } }],
      },
      select: { chatReview: true, chatReviewAt: true },
      orderBy: { chatReviewAt: 'desc' },
      take: 5,
    })
    for (const c of conversations) {
      const note = crewNoteOf(c.chatReview)
      if (!note) continue
      const bagian = safeSections(note)
      if (bagian.length === 0) continue
      const body: BookingBriefResponse = { ref, diperbaruiAt: note.diperbaruiAt, bagian }
      return NextResponse.json(body, { headers: { 'Cache-Control': 'private, no-store' } })
    }
    return NextResponse.json({ error: 'Tidak ada catatan untuk booking ini' }, { status: 404 })
  } catch (error) {
    console.error('GET /api/v1/booking-brief gagal', error)
    return NextResponse.json({ error: 'Gagal membaca catatan crew' }, { status: 500 })
  }
}
