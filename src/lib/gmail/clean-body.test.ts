import { describe, it, expect } from 'vitest'
import { cleanEmailBody, MAX_EMAIL_CONTENT_CHARS } from './clean-body'

describe('cleanEmailBody', () => {
  it('memotong di "On ... wrote:" (Gmail/Apple Mail)', () => {
    const raw = 'Jadi 4 orang ya.\n\nOn Mon, 22 Sep 2026 at 10:00, JVTO <hello@javavolcano-touroperator.com> wrote:\n> Berapa orang?\n> Terima kasih'
    expect(cleanEmailBody(raw)).toBe('Jadi 4 orang ya.')
  })

  it('memotong "On ... wrote:" yang terbungkus dua baris', () => {
    const raw = 'Oke setuju.\n\nOn Mon, 22 Sep 2026 at 10:00 Java Volcano Tour Operator <\nhello@javavolcano-touroperator.com> wrote:\n> lama'
    expect(cleanEmailBody(raw)).toBe('Oke setuju.')
  })

  it('memotong "Pada ... menulis:" (Gmail berbahasa Indonesia)', () => {
    const raw = 'Siap, transfer hari ini.\n\nPada Sen, 22 Sep 2026 pukul 10.00 JVTO <hello@x.com> menulis:\n> Total Rp 5.000.000'
    expect(cleanEmailBody(raw)).toBe('Siap, transfer hari ini.')
  })

  it('memotong blok Outlook "From: / Sent:"', () => {
    const raw = 'Please confirm pickup time.\n\nFrom: JVTO <hello@x.com>\nSent: Monday, September 22, 2026 10:00 AM\nTo: John\nSubject: Re: Bromo\n\nOld text'
    expect(cleanEmailBody(raw)).toBe('Please confirm pickup time.')
  })

  it('memotong "-----Original Message-----"', () => {
    expect(cleanEmailBody('Yes.\n-----Original Message-----\nold')).toBe('Yes.')
  })

  it('membuang baris kutipan ">" yang terselip di tengah (inline reply)', () => {
    const raw = '> Berapa orang?\n4 orang\n> Tanggal?\n12 Oktober'
    expect(cleanEmailBody(raw)).toBe('4 orang\n12 Oktober')
  })

  it('memotong signature "-- " dan footer ponsel', () => {
    expect(cleanEmailBody('Oke.\n-- \nJohn Doe\nCEO Acme')).toBe('Oke.')
    expect(cleanEmailBody('Oke.\n\nSent from my iPhone')).toBe('Oke.')
    expect(cleanEmailBody('Oke.\n\nDikirim dari Yahoo Mail di Android')).toBe('Oke.')
  })

  it('email TERUSAN dipertahankan utuh, termasuk blok From:/Date: di dalamnya', () => {
    const raw = 'FYI\n\n---------- Forwarded message ---------\nFrom: Klook <noreply@klook.com>\nDate: Mon, 22 Sep 2026\nSubject: Booking\n\nBooking #123 dikonfirmasi'
    const cleaned = cleanEmailBody(raw)
    expect(cleaned).toContain('Booking #123 dikonfirmasi')
    expect(cleaned).toContain('From: Klook')
  })

  it('email yang SELURUHNYA kutipan tidak jadi kosong -- teks asli dipertahankan', () => {
    const raw = 'On Mon, X wrote:\n> hanya kutipan'
    expect(cleanEmailBody(raw)).toBe(raw)
  })

  it('email berlapis empat: hanya balasan terbaru yang tersisa', () => {
    const raw = [
      'Balasan keempat: jadi berangkat tanggal 12.',
      '',
      'On Thu, JVTO wrote:',
      '> Balasan ketiga',
      '> On Wed, Tamu wrote:',
      '>> Balasan kedua',
      '>>> Email pertama: berapa harga Bromo?',
    ].join('\n')
    expect(cleanEmailBody(raw)).toBe('Balasan keempat: jadi berangkat tanggal 12.')
  })

  it('isi yang sangat panjang dipotong dengan penanda', () => {
    const cleaned = cleanEmailBody('a'.repeat(MAX_EMAIL_CONTENT_CHARS + 500))
    expect(cleaned.length).toBeLessThan(MAX_EMAIL_CONTENT_CHARS + 100)
    expect(cleaned).toContain('[dipotong')
  })

  it('CRLF dinormalkan', () => {
    expect(cleanEmailBody('Halo\r\nJVTO\r\n')).toBe('Halo\nJVTO')
  })
})
