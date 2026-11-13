import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { syncScheduleNote, scheduleNoteSyncEnabled } from './sync'
import { WA_NOTE_HEADER as H } from './merge'

const AT = new Date('2026-11-13T05:00:00.000Z')
type Call = { url: string; method: string; body: Record<string, unknown> | null }

function setup(responses: Array<{ status: number; json?: unknown } | 'throw'>) {
  const calls: Call[] = []
  const queue = [...responses]
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method ?? 'GET', body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null })
      const next = queue.shift()
      if (!next || next === 'throw') throw new Error('network')
      return { ok: next.status >= 200 && next.status < 300, status: next.status, json: async () => next.json ?? {} } as Response
    }),
  )
  return calls
}

beforeEach(() => {
  process.env.BOOKING_API_URL = 'https://backoffice.test/booking-overview/api?json=true'
  process.env.BOOKING_API_KEY = 'tok'
  process.env.SCHEDULE_NOTE_SYNC_ENABLED = '1'
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  delete process.env.SCHEDULE_NOTE_SYNC_ENABLED
})

describe('scheduleNoteSyncEnabled', () => {
  it('mati bila sakelar atau kredensial tidak ada', () => {
    expect(scheduleNoteSyncEnabled()).toBe(true)
    delete process.env.SCHEDULE_NOTE_SYNC_ENABLED
    expect(scheduleNoteSyncEnabled()).toBe(false)
    process.env.SCHEDULE_NOTE_SYNC_ENABLED = '1'
    delete process.env.BOOKING_API_KEY
    expect(scheduleNoteSyncEnabled()).toBe(false)
  })
})

describe('syncScheduleNote', () => {
  it('membaca note sekarang, menggabungkan, lalu menulis bersyarat dengan expected_note', async () => {
    const calls = setup([{ status: 200, json: { note: 'Driver: Egy', note_wa: null } }, { status: 200, json: { ok: true } }])
    expect(await syncScheduleNote('JVR/012/11/26', ['1 orang vegan'], AT)).toBe('written')
    expect(calls[0].url).toBe('https://backoffice.test/crew-notes-api/booking-note?ref=JVR%2F012%2F11%2F26')
    expect(calls[1].method).toBe('PUT')
    expect(calls[1].body).toMatchObject({ ref: 'JVR/012/11/26', expected_note: 'Driver: Egy', note: `Driver: Egy\n\n${H}\n- 1 orang vegan` })
    expect(calls[1].body?.note_wa).toMatchObject({ lines: ['1 orang vegan'], dismissed: [], prev: 'Driver: Egy' })
  })

  it('tidak menulis bila hasil gabungan sama dengan note sekarang', async () => {
    const calls = setup([{ status: 200, json: { note: `${H}\n- 1 orang vegan`, note_wa: { lines: ['1 orang vegan'], dismissed: [], prev: null, at: '' } } }])
    expect(await syncScheduleNote('X1', ['1 orang vegan'], AT)).toBe('unchanged')
    expect(calls).toHaveLength(1)
  })

  it('admin menyimpan di tengah (409 note_changed): baca ulang lalu gabung ulang, tulisan admin yang baru ikut', async () => {
    const calls = setup([
      { status: 200, json: { note: 'Driver: Egy', note_wa: null } },
      { status: 409, json: { error: 'note_changed' } },
      { status: 200, json: { note: 'Driver: Egy\nGuide ijen: Andi', note_wa: null } },
      { status: 200, json: { ok: true } },
    ])
    expect(await syncScheduleNote('X1', ['1 orang vegan'], AT)).toBe('written')
    expect(calls[3].body).toMatchObject({ expected_note: 'Driver: Egy\nGuide ijen: Andi', note: `Driver: Egy\nGuide ijen: Andi\n\n${H}\n- 1 orang vegan` })
  })

  it('note terus berubah: menyerah setelah tiga putaran tanpa menimpa apa pun', async () => {
    const calls = setup([
      { status: 200, json: { note: 'a' } }, { status: 409, json: { error: 'note_changed' } },
      { status: 200, json: { note: 'b' } }, { status: 409, json: { error: 'note_changed' } },
      { status: 200, json: { note: 'c' } }, { status: 409, json: { error: 'note_changed' } },
    ])
    expect(await syncScheduleNote('X1', ['1 orang vegan'], AT)).toBe('failed')
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(3)
  })

  it('404/422 tidak diulang; jaringan/5xx diminta diulang; tidak pernah melempar', async () => {
    setup([{ status: 404 }])
    expect(await syncScheduleNote('X1', ['a b c d'], AT)).toBe('failed')
    setup(['throw'])
    expect(await syncScheduleNote('X1', ['a b c d'], AT)).toBe('retry')
    setup([{ status: 200, json: { note: null } }, { status: 503 }])
    expect(await syncScheduleNote('X1', ['a b c d'], AT)).toBe('retry')
    setup([{ status: 200, json: { note: null } }, { status: 422 }])
    expect(await syncScheduleNote('X1', ['a b c d'], AT)).toBe('failed')
  })
})
