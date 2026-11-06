/**
 * Membuat "Catatan untuk crew" dari chat yang SUDAH ADA untuk semua trip mendatang (booking yang belum selesai), lalu
 * mengirimnya ke new-backoffice. Perlu dijalankan sekali setelah fitur dinyalakan: catatan normalnya baru dibuat saat
 * ada pesan baru, sehingga trip yang tamunya sudah selesai chat tidak akan pernah mendapat catatan.
 *
 *   npx tsx --env-file=.env scripts/backfill-crew-notes.ts            # uji kering: hanya menghitung kandidat
 *   npx tsx --env-file=.env scripts/backfill-crew-notes.ts --apply    # buat catatan dan kirim ke backoffice
 *
 * Memakai jalur yang sama dengan tombol "Perbarui sekarang" (`refreshChatReview`): satu panggilan LLM untuk ringkasan
 * dan satu untuk catatan crew per percakapan, sama dengan pemrosesan chat yang sudah berjalan. Berurutan, tanpa
 * paralel. Keluaran hanya id percakapan dan hitungan; tidak pernah isi chat atau catatan.
 *
 * Kandidat: percakapan bukan uji, punya bookingData, dan tanggal selesai trip (date.end_ymd) belum lewat hari ini WIB.
 * Gerbang "lewati nomor Indonesia" milik auto-refresh TIDAK berlaku di sini (permintaan owner 2026-11-07: semua trip
 * mendatang).
 */
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { refreshChatReview } from '@/lib/chat-review/refresh'
import { crewNoteOf } from '@/lib/chat-review/store'
import { crewNoteEnabled, crewNoteIsEmpty } from '@/lib/chat-review/crew-note'
import { crewNoteRefOf, crewNoteSyncConfigured, pushCrewNote } from '@/lib/chat-review/crew-note-sync'

/** Tanggal hari ini di WIB (YYYY-MM-DD). */
export function todayWib(now: Date = new Date()): string {
  return new Date(now.getTime() + 7 * 3_600_000).toISOString().slice(0, 10)
}

/** Booking belum selesai: `date.end_ymd` ada dan >= hari ini. Tanpa tanggal selesai = dianggap belum selesai bila `start_ymd` belum lewat. */
export function isUpcoming(bookingData: unknown, today: string): boolean {
  if (!bookingData || typeof bookingData !== 'object') return false
  const date = (bookingData as { date?: { start_ymd?: unknown; end_ymd?: unknown } }).date
  const end = typeof date?.end_ymd === 'string' ? date.end_ymd : null
  const start = typeof date?.start_ymd === 'string' ? date.start_ymd : null
  if (end) return end >= today
  return start ? start >= today : false
}

async function main() {
  const apply = process.argv.includes('--apply')
  const today = todayWib()
  if (apply && !crewNoteEnabled()) throw new Error('CREW_NOTE_ENABLED belum 1: catatan crew tidak akan dibuat')
  if (apply && !crewNoteSyncConfigured()) throw new Error('BOOKING_API_URL / BOOKING_API_KEY belum diatur: catatan tidak bisa dikirim ke backoffice')

  const rows = await prisma.conversation.findMany({
    where: { isTest: false, bookingData: { not: Prisma.DbNull } },
    select: { id: true, bookingData: true, chatReview: true },
  })
  const candidates = rows.filter((r) => r.bookingData && isUpcoming(r.bookingData, today))
  const already = candidates.filter((r) => crewNoteOf(r.chatReview)).length
  console.log(`Hari ini (WIB): ${today}`)
  console.log(`Percakapan ber-booking: ${rows.length}; trip mendatang: ${candidates.length}; sudah punya catatan: ${already}`)
  if (!apply) {
    console.log('Uji kering. Tambah --apply untuk membuat dan mengirim catatan.')
    return
  }

  const stats = { ok: 0, empty: 0, failed: 0, dengan_catatan: 0, catatan_kosong: 0, terkirim: 0, gagal_kirim: 0, tanpa_nomor: 0 }
  let i = 0
  for (const c of candidates) {
    i++
    try {
      const result = await refreshChatReview(c.id, new Date())
      stats[result.status]++
      if (result.status !== 'ok') {
        console.log(`[${i}/${candidates.length}] ${c.id} ${result.status}`)
        continue
      }
      const fresh = await prisma.conversation.findUnique({ where: { id: c.id }, select: { chatReview: true, bookingData: true } })
      const note = crewNoteOf(fresh?.chatReview)
      if (!note) {
        console.log(`[${i}/${candidates.length}] ${c.id} ok tanpa catatan (bukan tamu atau LLM gagal)`)
        continue
      }
      stats.dengan_catatan++
      if (crewNoteIsEmpty(note)) {
        stats.catatan_kosong++
        console.log(`[${i}/${candidates.length}] ${c.id} ok catatan kosong (tidak dikirim)`)
        continue
      }
      const ref = crewNoteRefOf(fresh?.bookingData)
      if (!ref) {
        stats.tanpa_nomor++
        console.log(`[${i}/${candidates.length}] ${c.id} ok catatan ada, nomor booking tidak ada`)
        continue
      }
      const sent = await pushCrewNote(ref, note)
      if (sent.ok) stats.terkirim++
      else stats.gagal_kirim++
      console.log(`[${i}/${candidates.length}] ${c.id} ok catatan ${sent.ok ? 'terkirim' : `gagal kirim (status ${sent.status ?? 'jaringan'})`}`)
    } catch (error) {
      stats.failed++
      console.log(`[${i}/${candidates.length}] ${c.id} galat ${error instanceof Error ? error.name : 'tidak diketahui'}`)
    }
  }
  console.log('Selesai:', JSON.stringify(stats))
}

if (process.argv[1]?.endsWith('backfill-crew-notes.ts')) {
  main()
    .catch((error) => {
      console.error('gagal:', error instanceof Error ? error.message : error)
      process.exitCode = 1
    })
    .finally(() => prisma.$disconnect())
}
