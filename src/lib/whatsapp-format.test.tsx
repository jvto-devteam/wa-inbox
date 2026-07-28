import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { formatWhatsAppText } from './whatsapp-format'

function html(text: string): string {
  const { container } = render(<>{formatWhatsAppText(text)}</>)
  return container.innerHTML
}

describe('formatWhatsAppText', () => {
  it('renders *text* as bold', () => {
    expect(html('Halo *dunia*')).toBe('Halo <strong>dunia</strong>')
  })

  it('renders _text_ as italic', () => {
    expect(html('Halo _dunia_')).toBe('Halo <em>dunia</em>')
  })

  it('renders ~text~ as strikethrough', () => {
    expect(html('Halo ~dunia~')).toBe('Halo <span class="line-through">dunia</span>')
  })

  it('renders ```text``` as monospace', () => {
    expect(html('Kode: ```const x = 1```')).toBe(
      'Kode: <code class="rounded bg-black/10 px-1 font-mono text-[0.9em]">const x = 1</code>'
    )
  })

  it('combines multiple independent marks in one string', () => {
    expect(html('*Penting*: jangan lupa _bawa paspor_')).toBe(
      '<strong>Penting</strong>: jangan lupa <em>bawa paspor</em>'
    )
  })

  it('leaves a marker touching whitespace as literal text (not a mark)', () => {
    expect(html('bintang * di tengah * kalimat')).toBe('bintang * di tengah * kalimat')
  })

  it('leaves an unmatched single marker as literal text', () => {
    expect(html('harga Rp 50*000')).toBe('harga Rp 50*000')
  })

  it('renders plain text with no markers unchanged', () => {
    expect(html('Halo, ada yang bisa dibantu?')).toBe('Halo, ada yang bisa dibantu?')
  })

  it('renders a bare URL as a clickable link', () => {
    expect(html('cek link https://example.com/x')).toBe(
      'cek link <a href="https://example.com/x" target="_blank" rel="noreferrer" class="text-brand underline">https://example.com/x</a>'
    )
  })

  it('does not swallow trailing punctuation into the link', () => {
    expect(html('cek link https://example.com/x!')).toBe(
      'cek link <a href="https://example.com/x" target="_blank" rel="noreferrer" class="text-brand underline">https://example.com/x</a>!'
    )
  })

  it('does not swallow a wrapping closing parenthesis into the link', () => {
    expect(html('(lihat https://example.com/x)')).toBe(
      '(lihat <a href="https://example.com/x" target="_blank" rel="noreferrer" class="text-brand underline">https://example.com/x</a>)'
    )
  })

  it('still applies bold/italic marks to plain text around a linked URL', () => {
    expect(html('*Portal*: https://example.com/x')).toBe(
      '<strong>Portal</strong>: <a href="https://example.com/x" target="_blank" rel="noreferrer" class="text-brand underline">https://example.com/x</a>'
    )
  })

  it('does not let a URL containing an underscore get mangled by the italic pass', () => {
    expect(html('https://example.com/my_booking_page')).toBe(
      '<a href="https://example.com/my_booking_page" target="_blank" rel="noreferrer" class="text-brand underline">https://example.com/my_booking_page</a>'
    )
  })
})
