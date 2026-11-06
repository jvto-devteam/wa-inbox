import type { CrewNote } from '@/lib/daily-summary/payload-schema'
import { CREW_NOTE_SECTIONS } from '@/lib/daily-summary/payload-schema'

/**
 * Mengirim "Catatan untuk crew" terbaru satu booking ke new-backoffice (POST /crew-notes-api/booking-notes), yang
 * menyimpannya di tabel `booking_crew_notes`; crew-portal membacanya dari sana (tanpa memanggil wa-inbox).
 *
 * Wa-inbox hanya punya PostgreSQL sendiri, jadi satu-satunya jalur ke database backoffice adalah endpoint itu, dengan
 * token sendiri (`CREW_NOTES_TOKEN`). Env kosong = pengiriman mati (catatan tetap tersimpan di wa-inbox dan tampil di
 * panel Inbox). Tidak pernah melempar dan tidak pernah memperlambat pemanggil: dijalankan di belakang; satu pengulangan
 * bila gagal karena jaringan/5xx; 404 (booking tidak ditemukan di backoffice), 409, dan 422 tidak diulang.
 */

export const CREW_NOTE_RETRY_DELAY_MS = 60_000
const REQUEST_TIMEOUT_MS = 8_000

export function crewNoteSyncConfigured(): boolean {
  return Boolean(process.env.CREW_NOTES_API_URL?.trim() && process.env.CREW_NOTES_TOKEN?.trim())
}

/** Nomor booking untuk backoffice: `bookingData.booking_number`, atau `id` bila tidak ada (sama dengan /api/v1/summaries). */
export function crewNoteRefOf(bookingData: unknown): string | null {
  if (!bookingData || typeof bookingData !== 'object') return null
  const b = bookingData as Record<string, unknown>
  for (const key of ['booking_number', 'id'] as const) {
    const v = b[key]
    if (typeof v === 'string' && v.trim()) return v.trim()
    if (typeof v === 'number') return String(v)
  }
  return null
}

export type PushResult = { ok: true } | { ok: false; retryable: boolean; status: number | null }

export async function pushCrewNote(ref: string, note: CrewNote): Promise<PushResult> {
  try {
    const base = (process.env.CREW_NOTES_API_URL ?? '').trim().replace(/\/+$/, '')
    const sections = Object.fromEntries(CREW_NOTE_SECTIONS.map((s) => [s, note[s]]))
    const res = await fetch(`${base}/crew-notes-api/booking-notes`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        authorization: `Bearer ${process.env.CREW_NOTES_TOKEN ?? ''}`,
      },
      body: JSON.stringify({ ref, generated_at: note.diperbaruiAt, note: sections }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (res.ok) return { ok: true }
    // 429 dan 5xx mungkin sementara; sisanya (401/404/409/422) tidak akan berubah dengan mengulang.
    return { ok: false, retryable: res.status === 429 || res.status >= 500, status: res.status }
  } catch (error) {
    console.error('[crew-note-sync] gagal menghubungi backoffice', { error: error instanceof Error ? error.name : 'unknown' })
    return { ok: false, retryable: true, status: null }
  }
}

/** Dipanggil sesudah catatan baru tersimpan. Kembali segera; kirim dan satu pengulangan terjadi di belakang. */
export function scheduleCrewNotePush(ref: string | null, note: CrewNote | null | undefined): void {
  if (!ref || !note || !crewNoteSyncConfigured()) return
  void (async () => {
    const first = await pushCrewNote(ref, note)
    if (first.ok) return
    console.error('[crew-note-sync] pengiriman catatan crew gagal', { status: first.status, retryable: first.retryable })
    if (!first.retryable) return
    const timer = setTimeout(() => {
      void pushCrewNote(ref, note).then((second) => {
        if (!second.ok) console.error('[crew-note-sync] pengulangan gagal', { status: second.status })
      })
    }, CREW_NOTE_RETRY_DELAY_MS)
    timer.unref?.()
  })()
}
