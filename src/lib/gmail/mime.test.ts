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

describe('buildReplyMime', () => {
  it('menyusun header balasan yang menjaga thread', () => {
    const mime = decode(buildReplyMime(base))
    const [head] = mime.split('\r\n\r\n')
    expect(head).toContain('From: hello@javavolcano-touroperator.com')
    expect(head).toContain('To: sinta@example.com')
    expect(head).toContain('Subject: Re: Tur Bromo')
    expect(head).toContain('In-Reply-To: <abc@mail.gmail.com>')
    expect(head).toContain('References: <root@x> <abc@mail.gmail.com>')
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
})
