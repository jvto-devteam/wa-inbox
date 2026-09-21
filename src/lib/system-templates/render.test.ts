import { describe, it, expect } from 'vitest'
import { renderSystemTemplate, validateTemplateBody, placeholdersIn } from './render'
import type { SystemTemplateVariable } from './types'

const vars = (...defs: [string, boolean][]): SystemTemplateVariable[] =>
  defs.map(([name, required]) => ({ name, required }))

describe('renderSystemTemplate', () => {
  it('fills named placeholders', () => {
    const result = renderSystemTemplate(
      { body: 'Hi {name}, booking {booking_code} confirmed.', variables: vars(['name', true], ['booking_code', true]) },
      { name: 'Anna', booking_code: 'JVTO-1' }
    )
    expect(result).toEqual({ ok: true, text: 'Hi Anna, booking JVTO-1 confirmed.' })
  })

  it('accepts numbers and renders them as text', () => {
    const result = renderSystemTemplate({ body: '{pax} pax', variables: vars(['pax', true]) }, { pax: 4 })
    expect(result).toEqual({ ok: true, text: '4 pax' })
  })

  it('refuses to render when a required variable is missing or blank, naming every one', () => {
    const result = renderSystemTemplate(
      { body: '{name} {booking_code} {pax}', variables: vars(['name', true], ['booking_code', true], ['pax', true]) },
      { name: 'Anna', booking_code: '   ' }
    )
    expect(result).toEqual({ ok: false, missing: ['booking_code', 'pax'] })
  })

  it('drops the whole line of an optional variable that is empty', () => {
    // Replaces PHP's `$isDrop = $wa['drop'] != '' ? "\r\n*Drop:* ..." : ""`.
    const body = '*New Booking*\n*Pickup:* {pickup}\n*Drop:* {drop}\n*Payment:* {payment}'
    const variables = vars(['pickup', true], ['drop', false], ['payment', true])

    expect(renderSystemTemplate({ body, variables }, { pickup: 'Surabaya', payment: 'Bank' })).toEqual({
      ok: true,
      text: '*New Booking*\n*Pickup:* Surabaya\n*Payment:* Bank',
    })
    expect(renderSystemTemplate({ body, variables }, { pickup: 'Surabaya', drop: 'Bali', payment: 'Bank' })).toEqual({
      ok: true,
      text: '*New Booking*\n*Pickup:* Surabaya\n*Drop:* Bali\n*Payment:* Bank',
    })
  })

  it('does not leave a double blank gap where a dropped line sat between paragraphs', () => {
    const body = 'A\n\n{note}\n\nB'
    expect(renderSystemTemplate({ body, variables: vars(['note', false]) }, {})).toEqual({ ok: true, text: 'A\n\nB' })
  })

  it('never re-expands a placeholder that arrives inside a value', () => {
    const result = renderSystemTemplate(
      { body: '{name} / {code}', variables: vars(['name', true], ['code', true]) },
      { name: '{code}', code: 'X' }
    )
    expect(result).toEqual({ ok: true, text: '{code} / X' })
  })

  it('ignores variables the template does not declare', () => {
    expect(renderSystemTemplate({ body: 'Hi', variables: [] }, { stray: 'x' })).toEqual({ ok: true, text: 'Hi' })
  })

  it('normalises Windows line endings coming from the PHP originals', () => {
    expect(renderSystemTemplate({ body: 'A\r\nB', variables: [] }, {})).toEqual({ ok: true, text: 'A\nB' })
  })
})

describe('validateTemplateBody', () => {
  it('accepts a body that only uses declared variables', () => {
    expect(validateTemplateBody('Hi {name}', vars(['name', true]))).toEqual([])
  })

  it('rejects a placeholder the template does not declare', () => {
    expect(validateTemplateBody('Hi {nama}', vars(['name', true]))).toEqual([
      'Variabel {nama} dipakai di teks tetapi tidak dideklarasikan.',
    ])
  })

  it('rejects an empty body', () => {
    expect(validateTemplateBody('   ', [])).toEqual(['Teks pesan tidak boleh kosong.'])
  })
})

describe('placeholdersIn', () => {
  it('lists each placeholder once, in order of first use', () => {
    expect(placeholdersIn('{a} {b} {a} {C} {x_1}')).toEqual(['a', 'b', 'x_1'])
  })
})
