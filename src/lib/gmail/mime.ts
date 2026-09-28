import { WA_INBOX_ID_HEADER } from './parse'

/**
 * MIME RFC 2822 untuk satu balasan teks polos, dalam base64url (bentuk `raw` Gmail).
 *
 * Setiap nilai header dilewatkan stripCrlf: subjek dan alamat berasal dari email pelanggan,
 * dan satu CR/LF di sana cukup untuk menyuntik `Bcc:` ke balasan JVTO.
 */
export interface ReplyMimeInput {
  from: string
  to: string
  subject: string
  inReplyTo: string | null
  references: string | null
  waInboxId: string
  text: string
}

const stripCrlf = (value: string) => value.replace(/[\r\n]+/g, ' ').trim()

export function encodeHeaderWord(value: string): string {
  const clean = stripCrlf(value)
  return /^[\x20-\x7e]*$/.test(clean) ? clean : `=?UTF-8?B?${Buffer.from(clean, 'utf8').toString('base64')}?=`
}

export function replySubject(subject: string | null): string {
  const base = stripCrlf(subject ?? '')
  if (!base) return 'Re: (tanpa subjek)'
  return /^re:/i.test(base) ? base : `Re: ${base}`
}

export function buildReplyMime(input: ReplyMimeInput): string {
  // Fix round 1 (Temuan 2): Message-ID Gmail ~70 karakter -- setelah ~14 balasan di satu
  // benang, References tanpa fold melewati batas keras 998 oktet per baris (RFC 5322
  // §2.1.1) dan Gmail bisa menolak balasan selanjutnya secara permanen. Setiap id dipecah
  // lewat split(/\s+/) (CRLF/spasi apa pun jadi pemisah), lalu digabung ulang dengan CRLF +
  // spasi -- satu id per baris lanjutan (folding whitespace RFC 5322 §2.2.3). Untuk satu id
  // saja, join tidak menyisipkan pemisah apa pun, jadi perilaku lama (satu baris) tetap sama.
  const referenceIds = [input.references, input.inReplyTo]
    .filter((v): v is string => Boolean(v))
    .flatMap((v) => v.split(/\s+/).filter(Boolean))
  const references = referenceIds.join('\r\n ')
  const headers = [
    `From: ${stripCrlf(input.from)}`,
    `To: ${stripCrlf(input.to)}`,
    `Subject: ${encodeHeaderWord(input.subject)}`,
    ...(input.inReplyTo ? [`In-Reply-To: ${stripCrlf(input.inReplyTo)}`] : []),
    // Kalau References asal sudah memuat In-Reply-To, ia muncul dua kali. Pembaca email
    // mentoleransinya, dan membuang duplikat tidak sepadan dengan risiko salah memotong.
    ...(references ? [`References: ${references}`] : []),
    `${WA_INBOX_ID_HEADER}: ${stripCrlf(input.waInboxId)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
  ]
  const body = Buffer.from(input.text.replace(/\r?\n/g, '\r\n'), 'utf8')
    .toString('base64')
    .replace(/.{1,76}/g, '$&\r\n')
  return Buffer.from(`${headers.join('\r\n')}\r\n\r\n${body}`, 'utf8').toString('base64url')
}
