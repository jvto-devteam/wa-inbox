import { describe, it, expect } from 'vitest'
import { parseGmailMessage, decodeMimeWords, parseAddress, htmlToText } from './parse'
import type { GmailMessage, GmailMessagePart } from './types'

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url')

function message(payload: GmailMessagePart, extra: Partial<GmailMessage> = {}): GmailMessage {
  return { id: 'gm_1', threadId: 'th_1', labelIds: ['INBOX'], internalDate: '1759000000000', payload, ...extra }
}

describe('decodeMimeWords', () => {
  it('mendekode encoded-word B dan Q, termasuk dua kata bersebelahan', () => {
    expect(decodeMimeWords('=?UTF-8?B?QnJvbW8g8J+MiyBJamVu?=')).toBe('Bromo 🌋 Ijen')
    expect(decodeMimeWords('=?ISO-8859-1?Q?Jos=E9_Garc=EDa?=')).toBe('José García')
    expect(decodeMimeWords('=?UTF-8?B?QnJvbW8=?= =?UTF-8?B?IElqZW4=?=')).toBe('Bromo Ijen')
  })

  it('membiarkan teks biasa apa adanya (idempoten)', () => {
    expect(decodeMimeWords('Tour Bromo 3D2N')).toBe('Tour Bromo 3D2N')
  })
})

describe('parseAddress', () => {
  it('memisah nama dan alamat, alamat jadi huruf kecil', () => {
    expect(parseAddress('"Sinta W." <Sinta@Example.COM>')).toEqual({ address: 'sinta@example.com', name: 'Sinta W.' })
    expect(parseAddress('sinta@example.com')).toEqual({ address: 'sinta@example.com', name: null })
  })

  it('nama ber-encoded-word ikut didekode', () => {
    expect(parseAddress('=?UTF-8?B?Sm9zw6k=?= <jose@example.com>')).toEqual({ address: 'jose@example.com', name: 'José' })
  })

  it('null kalau tidak ada alamat yang bisa dibalas', () => {
    expect(parseAddress('undisclosed-recipients:;')).toBeNull()
  })
})

describe('htmlToText', () => {
  it('membuang style/script, mengubah blok jadi baris, mendekode entitas', () => {
    const html = '<html><head><style>p{color:red}</style></head><body><p>Halo&nbsp;JVTO,</p><div>Harga &amp; jadwal?</div><br>Terima kasih</body></html>'
    expect(htmlToText(html)).toBe('Halo JVTO,\nHarga & jadwal?\n\nTerima kasih')
  })

  it('membuang kutipan gmail_quote dan blockquote', () => {
    const html = '<div>Jadi 4 orang ya</div><div class="gmail_quote"><div>On Mon, X wrote:</div><blockquote>pesan lama</blockquote></div>'
    expect(htmlToText(html)).toBe('Jadi 4 orang ya')
  })

  it('email TERUSAN tidak dibuang walau memakai gmail_quote', () => {
    const html = '<div>FYI</div><div class="gmail_quote"><div>---------- Forwarded message ---------</div><div>Booking #123 dikonfirmasi</div></div>'
    const text = htmlToText(html)
    expect(text).toContain('Forwarded message')
    expect(text).toContain('Booking #123 dikonfirmasi')
  })

  it('menormalkan NBSP mentah (bukan hanya entitas &nbsp;) jadi spasi biasa', () => {
    const html = '<p>Harga Bromo </p><p>OK</p>'
    const text = htmlToText(html)
    expect(text).not.toContain(' ')
    expect(text).toBe('Harga Bromo\nOK')
  })
})

describe('parseGmailMessage', () => {
  const headers = [
    { name: 'From', value: 'Sinta <sinta@example.com>' },
    { name: 'Subject', value: '=?UTF-8?B?VHVyIEJyb21vIPCfjIs=?=' },
  ]

  it('memilih text/plain dalam multipart/alternative', () => {
    const parsed = parseGmailMessage(message({
      mimeType: 'multipart/alternative', headers,
      parts: [
        { mimeType: 'text/plain', body: { data: b64('Halo, masih ada slot?') } },
        { mimeType: 'text/html', body: { data: b64('<p>Halo, masih ada slot?</p>') } },
      ],
    }))
    expect(parsed.body).toBe('Halo, masih ada slot?')
    expect(parsed.subject).toBe('Tur Bromo 🌋')
    expect(parsed.from).toEqual({ address: 'sinta@example.com', name: 'Sinta' })
    expect(parsed.sentAt.toISOString()).toBe(new Date(1759000000000).toISOString())
  })

  it('email hanya-HTML (tanpa text/plain) jadi teks terbaca', () => {
    const parsed = parseGmailMessage(message({
      mimeType: 'text/html', headers,
      body: { data: b64('<table><tr><td>Booking</td></tr><tr><td>Bromo 12 Okt</td></tr></table><style>.x{}</style>') },
    }))
    expect(parsed.body).toBe('Booking\nBromo 12 Okt')
    expect(parsed.body).not.toMatch(/[<>{}]/)
  })

  it('text/plain kosong jatuh ke HTML', () => {
    const parsed = parseGmailMessage(message({
      mimeType: 'multipart/alternative', headers,
      parts: [
        { mimeType: 'text/plain', body: { data: b64('   ') } },
        { mimeType: 'text/html', body: { data: b64('<p>Isi sebenarnya</p>') } },
      ],
    }))
    expect(parsed.body).toBe('Isi sebenarnya')
  })

  it('mencatat nama lampiran tanpa membaca isinya', () => {
    const parsed = parseGmailMessage(message({
      mimeType: 'multipart/mixed', headers,
      parts: [
        { mimeType: 'text/plain', body: { data: b64('Paspor terlampir') } },
        { mimeType: 'application/pdf', filename: 'paspor.pdf', body: { attachmentId: 'att_1', size: 12000 } },
      ],
    }))
    expect(parsed.attachments).toEqual(['paspor.pdf'])
    expect(parsed.body).toBe('Paspor terlampir')
  })

  it('menghormati charset part selain UTF-8', () => {
    const latin1 = Buffer.from('Café à Bromo', 'latin1').toString('base64url')
    const parsed = parseGmailMessage(message({
      mimeType: 'text/plain', headers: [...headers],
      body: { data: latin1 },
      // charset dibaca dari header Content-Type part itu sendiri
    }, {}))
    expect(parsed.body).not.toBe('Café à Bromo') // tanpa header charset: dibaca sebagai UTF-8
    const withCharset = parseGmailMessage(message({
      mimeType: 'text/plain',
      headers: [...headers, { name: 'Content-Type', value: 'text/plain; charset="ISO-8859-1"' }],
      body: { data: latin1 },
    }))
    expect(withCharset.body).toBe('Café à Bromo')
  })

  it('membaca X-WA-Inbox-Id tanpa peka huruf', () => {
    const parsed = parseGmailMessage(message({
      mimeType: 'text/plain', headers: [...headers, { name: 'x-wa-inbox-id', value: 'msg_abc' }],
      body: { data: b64('x') },
    }))
    expect(parsed.waInboxId).toBe('msg_abc')
  })
})
