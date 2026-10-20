import { describe, expect, it } from 'vitest'
import { canRevertBatch, canRevertValue, eventValueText, reasonText } from './view'

describe('canRevertValue / canRevertBatch (shared by server and UI)', () => {
  it('refuses null, blank, and the fake 07:00 time; accepts real values', () => {
    expect(canRevertValue('pickup_time', null)).toBe(false)
    expect(canRevertValue('pickup_point', '  ')).toBe(false)
    expect(canRevertValue('drop_time', '07:00')).toBe(false)
    expect(canRevertValue('pickup_time', '10:30')).toBe(true)
    expect(canRevertValue('pickup_point', 'Surabaya Airport')).toBe(true)
  })

  it('a batch needs every member revertable and a non-empty previousDetail', () => {
    const ok = [{ field: 'pickup_point', oldValue: 'Surabaya Airport' }]
    expect(canRevertBatch(ok)).toBe(true)
    expect(canRevertBatch(ok, { pickup_detail: 'GA 300' })).toBe(true)
    expect(canRevertBatch(ok, { pickup_detail: null })).toBe(false)
    expect(canRevertBatch([...ok, { field: 'pickup_detail', oldValue: null }])).toBe(false)
    expect(canRevertBatch([])).toBe(false)
  })
})

describe('eventValueText / reasonText (final review cheap minor: readable history)', () => {
  it('object values from closeAction/CREATED/DATA_REQUEST/DRAFT_SENT are readable text, never raw JSON', () => {
    expect(eventValueText({ field: 'pickup_time', value: '09:00' })).toBe('Jam pickup: 09:00')
    expect(eventValueText({ type: 'CHANGE', field: 'tshirt_sizes', value: 'M x 2' })).toBe('Ukuran kaos: M x 2')
    expect(eventValueText({ type: 'DATA_REQUEST', fields: ['pickup_time', 'drop_time'], forDay: '2026-10-20' })).toBe('Minta: Jam pickup, Jam drop-off (untuk 2026-10-20)')
    expect(eventValueText({ messageId: 'm1', auto: true })).toBe('Dikirim otomatis')
    expect(eventValueText({ field: 'note', value: null })).toBe('Catatan: -')
    expect(eventValueText('10:30')).toBe('10:30')
    expect(eventValueText(null)).toBe('-')
    for (const v of [{ a: { b: 1 } }, { x: 1 }]) expect(eventValueText(v)).not.toMatch(/[{}"]/)
  })
  it('system reason codes are shown in Indonesian; free text stays', () => {
    expect(reasonText('MATCHED_IN_BACKOFFICE')).toBe('Sudah sesuai di backoffice')
    expect(reasonText('CHAT_CORRECTED')).toBe('Tamu mengoreksi di chat')
    expect(reasonText('BOOKING_CHANGED')).toBe('Booking percakapan berganti')
    expect(reasonText('Kabar ke vendor Bali gagal (CANCELLED)')).toBe('Kabar ke vendor Bali gagal (CANCELLED)')
  })
})
