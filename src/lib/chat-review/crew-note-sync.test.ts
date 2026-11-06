/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyCrewNote } from './crew-note'
import {
  CREW_NOTE_RETRY_DELAY_MS,
  crewNoteRefOf,
  crewNotesBaseUrl,
  crewNoteSyncConfigured,
  pushCrewNote,
  scheduleCrewNotePush,
} from './crew-note-sync'

const NOW = new Date('2026-11-06T03:00:00Z')
const note = { ...emptyCrewNote(NOW), perubahan: ['Jemput tour 20 Nov jam 11:00, bukan 08:00.'] }

function stubFetch(...statuses: (number | Error)[]) {
  const queue = [...statuses]
  const fetchMock = vi.fn(async (...args: [RequestInfo | URL, RequestInit?]) => {
    void args
    const next = queue.length > 1 ? queue.shift()! : queue[0]
    if (next instanceof Error) throw next
    return { ok: next >= 200 && next < 300, status: next } as Response
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  process.env.BOOKING_API_URL = 'https://bo.test/booking-overview/api?json=true'
  process.env.BOOKING_API_KEY = 'tok_rahasia'
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  delete process.env.BOOKING_API_URL
  delete process.env.BOOKING_API_KEY
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('crewNoteRefOf', () => {
  it('memakai booking_number, lalu id (string atau angka); selain itu null', () => {
    expect(crewNoteRefOf({ booking_number: ' JVR/012/11/26 ', id: 'x' })).toBe('JVR/012/11/26')
    expect(crewNoteRefOf({ id: 'XUH858929' })).toBe('XUH858929')
    expect(crewNoteRefOf({ id: 3919 })).toBe('3919')
    expect(crewNoteRefOf({})).toBeNull()
    expect(crewNoteRefOf(null)).toBeNull()
    expect(crewNoteRefOf('teks')).toBeNull()
  })
})

describe('crewNotesBaseUrl / crewNoteSyncConfigured', () => {
  it('alamat diambil dari asal BOOKING_API_URL; butuh URL yang sah dan key', () => {
    expect(crewNotesBaseUrl()).toBe('https://bo.test')
    expect(crewNoteSyncConfigured()).toBe(true)
    delete process.env.BOOKING_API_KEY
    expect(crewNoteSyncConfigured()).toBe(false)
    process.env.BOOKING_API_KEY = ' '
    expect(crewNoteSyncConfigured()).toBe(false)
    process.env.BOOKING_API_KEY = 'k'
    process.env.BOOKING_API_URL = 'bukan url'
    expect(crewNotesBaseUrl()).toBeNull()
    expect(crewNoteSyncConfigured()).toBe(false)
    delete process.env.BOOKING_API_URL
    expect(crewNoteSyncConfigured()).toBe(false)
  })
})

describe('pushCrewNote', () => {
  it('mengirim sembilan bagian, nomor booking, dan token ke endpoint backoffice', async () => {
    const fetchMock = stubFetch(200)
    expect(await pushCrewNote('JVR/012/11/26', note)).toEqual({ ok: true })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://bo.test/crew-notes-api/booking-notes')
    expect((init?.headers as Record<string, string>)['x-internal-token']).toBe('tok_rahasia')
    expect((init?.headers as Record<string, string>).authorization).toBeUndefined()
    const body = JSON.parse(String(init?.body))
    expect(body.ref).toBe('JVR/012/11/26')
    expect(body.generated_at).toBe(note.diperbaruiAt)
    expect(Object.keys(body.note)).toEqual(['perubahan', 'waktuKritis', 'siapa', 'karakter', 'kebutuhan', 'permintaan', 'logistik', 'janjiTim', 'jangan'])
    expect(body.note.perubahan).toEqual(note.perubahan)
    expect(JSON.stringify(body)).not.toContain('diperbaruiAt')
  })

  it.each([
    [500, true],
    [503, true],
    [429, true],
    [404, false],
    [409, false],
    [422, false],
    [401, false],
  ])('status %i: retryable=%s', async (status, retryable) => {
    stubFetch(status)
    expect(await pushCrewNote('JVR/1', note)).toEqual({ ok: false, retryable, status })
  })

  it('galat jaringan atau timeout: tidak melempar, dapat diulang', async () => {
    stubFetch(new Error('timeout'))
    expect(await pushCrewNote('JVR/1', note)).toEqual({ ok: false, retryable: true, status: null })
  })
})

describe('scheduleCrewNotePush', () => {
  it('tidak melakukan apa pun tanpa nomor booking, tanpa catatan, atau bila env kosong', async () => {
    const fetchMock = stubFetch(200)
    scheduleCrewNotePush(null, note)
    scheduleCrewNotePush('JVR/1', null)
    delete process.env.BOOKING_API_KEY
    scheduleCrewNotePush('JVR/1', note)
    await Promise.resolve()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('mengirim sekali bila berhasil', async () => {
    vi.useFakeTimers()
    const fetchMock = stubFetch(200)
    scheduleCrewNotePush('JVR/1', note)
    await vi.advanceTimersByTimeAsync(CREW_NOTE_RETRY_DELAY_MS * 2)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('mengulang satu kali setelah jeda bila 5xx, lalu berhenti', async () => {
    vi.useFakeTimers()
    const fetchMock = stubFetch(503)
    scheduleCrewNotePush('JVR/1', note)
    await vi.advanceTimersByTimeAsync(10)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(CREW_NOTE_RETRY_DELAY_MS + 10)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(CREW_NOTE_RETRY_DELAY_MS * 5)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('tidak mengulang bila booking tidak ditemukan (404)', async () => {
    vi.useFakeTimers()
    const fetchMock = stubFetch(404)
    scheduleCrewNotePush('JVR/1', note)
    await vi.advanceTimersByTimeAsync(CREW_NOTE_RETRY_DELAY_MS * 3)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
