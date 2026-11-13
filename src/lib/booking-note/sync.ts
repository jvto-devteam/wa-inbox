import { crewNoteRefOf, crewNoteSyncConfigured, crewNotesBaseUrl } from '@/lib/chat-review/crew-note-sync'
import { mergeScheduleNote, type WaNoteState } from './merge'

/**
 * Mengirim note dari chat WA ke `bookings.note` new-backoffice (owner 2026-11-13). Penggabungan dilakukan DI SINI
 * (`merge.ts`); backoffice hanya menyimpan dan menjaga satu hal: tulis hanya jika `note` di DB masih sama dengan yang
 * kita baca (`expected_note`), selain itu 409 `note_changed` dan kita membaca ulang lalu menggabung lagi.
 *
 * Alamat dan kredensial SAMA dengan catatan crew (`BOOKING_API_URL` origin + `BOOKING_API_KEY` sebagai
 * `X-Internal-Token`). Sakelar: `SCHEDULE_NOTE_SYNC_ENABLED=1` (bawaan mati). Tidak pernah melempar dan tidak pernah
 * memperlambat pemanggil: dijalankan di belakang.
 */

const REQUEST_TIMEOUT_MS = 8_000
const MAX_CONFLICT_ROUNDS = 3
export const SCHEDULE_NOTE_RETRY_DELAY_MS = 60_000

export function scheduleNoteSyncEnabled(): boolean {
  return process.env.SCHEDULE_NOTE_SYNC_ENABLED === '1' && crewNoteSyncConfigured()
}

export type SyncOutcome = 'written' | 'unchanged' | 'failed' | 'retry'

type Remote = { note: string | null; state: WaNoteState | null }
type Fetched = { ok: true; remote: Remote } | { ok: false; retryable: boolean; status: number | null }

function headers(): Record<string, string> {
  return { 'content-type': 'application/json', accept: 'application/json', 'x-internal-token': process.env.BOOKING_API_KEY?.trim() ?? '' }
}

function parseState(raw: unknown): WaNoteState | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
  return { lines: strings(o.lines), dismissed: strings(o.dismissed), prev: typeof o.prev === 'string' ? o.prev : null, at: typeof o.at === 'string' ? o.at : '', admin: typeof o.admin === 'string' ? o.admin : null }
}

async function fetchRemote(ref: string): Promise<Fetched> {
  try {
    const res = await fetch(`${crewNotesBaseUrl() ?? ''}/crew-notes-api/booking-note?ref=${encodeURIComponent(ref)}`, { headers: headers(), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
    if (!res.ok) return { ok: false, retryable: res.status === 429 || res.status >= 500, status: res.status }
    const body = (await res.json()) as { note?: unknown; note_wa?: unknown }
    return { ok: true, remote: { note: typeof body.note === 'string' ? body.note : null, state: parseState(body.note_wa) } }
  } catch {
    return { ok: false, retryable: true, status: null }
  }
}

type Put = { kind: 'ok' } | { kind: 'conflict' } | { kind: 'error'; retryable: boolean; status: number | null }

async function putRemote(ref: string, expectedNote: string | null, note: string | null, state: WaNoteState): Promise<Put> {
  try {
    const res = await fetch(`${crewNotesBaseUrl() ?? ''}/crew-notes-api/booking-note`, {
      method: 'PUT',
      headers: headers(),
      body: JSON.stringify({ ref, expected_note: expectedNote, note, note_wa: state }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (res.ok) return { kind: 'ok' }
    if (res.status === 409) {
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      if (body.error === 'note_changed') return { kind: 'conflict' }
    }
    return { kind: 'error', retryable: res.status === 429 || res.status >= 500, status: res.status }
  } catch {
    return { kind: 'error', retryable: true, status: null }
  }
}

/** Satu putaran lengkap: baca note sekarang, gabungkan, tulis bersyarat; ulang bila admin menyimpan di tengah. */
export async function syncScheduleNote(ref: string, lines: string[], at: Date): Promise<SyncOutcome> {
  for (let round = 0; round < MAX_CONFLICT_ROUNDS; round++) {
    const got = await fetchRemote(ref)
    if (!got.ok) {
      console.error('[schedule-note-sync] gagal membaca note', { status: got.status, retryable: got.retryable })
      return got.retryable ? 'retry' : 'failed'
    }
    const merged = mergeScheduleNote({ current: got.remote.note, state: got.remote.state, incoming: lines, at })
    if (!merged.changed) return 'unchanged'
    const put = await putRemote(ref, got.remote.note, merged.note, merged.state)
    if (put.kind === 'ok') return 'written'
    if (put.kind === 'error') {
      console.error('[schedule-note-sync] gagal menulis note', { status: put.status, retryable: put.retryable })
      return put.retryable ? 'retry' : 'failed'
    }
    // conflict: admin menyimpan note di antara baca dan tulis -> baca ulang.
  }
  console.error('[schedule-note-sync] note terus berubah, dilewati sampai pembaruan berikutnya')
  return 'failed'
}

/** Dipanggil sesudah note untuk Schedule berubah. Kembali segera; kirim dan satu pengulangan terjadi di belakang. */
export function scheduleScheduleNoteSync(bookingData: unknown, lines: string[], at: Date): void {
  const ref = crewNoteRefOf(bookingData)
  if (!ref || !scheduleNoteSyncEnabled()) return
  void (async () => {
    if ((await syncScheduleNote(ref, lines, at)) !== 'retry') return
    const timer = setTimeout(() => void syncScheduleNote(ref, lines, at), SCHEDULE_NOTE_RETRY_DELAY_MS)
    timer.unref?.()
  })()
}
