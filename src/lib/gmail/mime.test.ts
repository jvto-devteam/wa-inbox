import { describe, it, expect } from 'vitest'
import { buildReplyMime, replySubject, encodeHeaderWord } from './mime'

const decode = (raw: string) => Buffer.from(raw, 'base64url').toString('utf8')
const base = {
  from: 'hello@javavolcano-touroperator.com', to: 'sinta@example.com', subject: 'Re: Tur Bromo',
  inReplyTo: '<abc@mail.gmail.com>', references: '<root@x> <abc@mail.gmail.com>', waInboxId: 'msg_1', text: 'Halo Sinta,\nSlot masih ada.',
}

describe('replySubject', () => {
  it('menambah "Re: " sekali saja', () => {
    expect(replySubject('Tur Bromo')).toBe('Re: Tur Bromo')
    expect(replySubject('RE: Tur Bromo')).toBe('RE: Tur Bromo')
    expect(replySubject(null)).toBe('Re: (tanpa subjek)')
  })
})

describe('encodeHeaderWord', () => {
  it('ASCII apa adanya, non-ASCII jadi encoded-word UTF-8', () => {
    expect(encodeHeaderWord('Re: Bromo')).toBe('Re: Bromo')
    expect(encodeHeaderWord('Re: Bromo 🌋')).toBe(`=?UTF-8?B?${Buffer.from('Re: Bromo 🌋').toString('base64')}?=`)
  })
})

// Fold RFC 5322 (CRLF + spasi) membuat References multi-id terlihat sebagai beberapa baris
// fisik; unfold membalikkannya jadi satu baris logis untuk perbandingan isi.
const unfold = (head: string) => head.replace(/\r\n /g, ' ')

describe('buildReplyMime', () => {
  it('menyusun header balasan yang menjaga thread', () => {
    const mime = decode(buildReplyMime(base))
    const [head] = mime.split('\r\n\r\n')
    expect(head).toContain('From: hello@javavolcano-touroperator.com')
    expect(head).toContain('To: sinta@example.com')
    expect(head).toContain('Subject: Re: Tur Bromo')
    expect(head).toContain('In-Reply-To: <abc@mail.gmail.com>')
    // Nilai References di-fold satu id per baris lanjutan (RFC 5322 -- lihat describe di bawah);
    // unfold dulu sebelum membandingkan isinya.
    expect(unfold(head)).toContain('References: <root@x> <abc@mail.gmail.com>')
    expect(head).toContain('X-WA-Inbox-Id: msg_1')
    expect(head).toContain('Content-Type: text/plain; charset="UTF-8"')
  })

  it('References dibangun dari In-Reply-To kalau pesan asal tidak punya References', () => {
    const head = decode(buildReplyMime({ ...base, references: null })).split('\r\n\r\n')[0]
    expect(head).toContain('References: <abc@mail.gmail.com>')
  })

  it('isi di-encode base64 dan kembali utuh (termasuk non-ASCII)', () => {
    const mime = decode(buildReplyMime({ ...base, text: 'Terima kasih 🙏\nSalam, JVTO' }))
    const body = mime.split('\r\n\r\n')[1].replace(/\r\n/g, '')
    expect(Buffer.from(body, 'base64').toString('utf8')).toBe('Terima kasih 🙏\r\nSalam, JVTO')
  })

  it('CR/LF di nilai header tidak bisa menyuntik header baru', () => {
    const mime = decode(buildReplyMime({ ...base, subject: 'Halo\r\nBcc: korban@x.com', to: 'sinta@example.com\nBcc: korban@x.com' }))
    const head = mime.split('\r\n\r\n')[0]
    expect(head.split('\r\n').some((line) => line.startsWith('Bcc:'))).toBe(false)
  })

  // Fix round 1 (Temuan 2): Message-ID Gmail ~70 karakter -- tanpa fold, References di
  // benang panjang (~14+ balasan) melewati batas keras 998 oktet per baris (RFC 5322 §2.1.1)
  // dan Gmail bisa menolak balasan selanjutnya secara permanen.
  it('References panjang di-fold satu id per baris supaya tidak melebihi 998 oktet (RFC 5322)', () => {
    const ids = Array.from(
      { length: 20 },
      (_, i) => `<id${i}-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx@mail.gmail.com>`,
    )
    const mime = decode(buildReplyMime({ ...base, references: ids.join(' ') }))
    const head = mime.split('\r\n\r\n')[0]

    for (const line of head.split('\r\n')) expect(line.length).toBeLessThanOrEqual(998)

    const unfolded = unfold(head)
    const referencesLine = unfolded.split('\r\n').find((line) => line.startsWith('References:'))
    expect(referencesLine).toBeDefined()
    for (const id of ids) expect(referencesLine).toContain(id)
    expect(referencesLine).toContain(base.inReplyTo)
  })
})
