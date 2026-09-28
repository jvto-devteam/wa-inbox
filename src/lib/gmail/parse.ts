import type { GmailHeader, GmailMessage, GmailMessagePart } from './types'

/**
 * Pohon MIME Gmail -> satu email yang bisa ditulis ke Message.
 *
 * Isi yang dihasilkan di sini masih MENTAH (belum dibuang kutipannya). Pembersihan ada di
 * clean-body.ts -- kecuali kutipan versi HTML, yang harus dibuang di sini, SEBELUM tag
 * diratakan: setelah jadi teks, `<blockquote>` sudah tidak bisa dibedakan dari isi biasa.
 */

/** Header penanda email yang dikirim wa-inbox sendiri (src/lib/gmail/mime.ts). */
export const WA_INBOX_ID_HEADER = 'X-WA-Inbox-Id'

export interface EmailAddress {
  address: string
  name: string | null
}

export interface ParsedEmail {
  id: string
  threadId: string
  labelIds: string[]
  sentAt: Date
  from: EmailAddress | null
  // Reply-To (spec §11 temuan review): relay form/OTA/notifikasi mengirim dari `noreply@...`
  // tapi minta balasan ke alamat tamu yang sesungguhnya. Dibaca terpisah dari From supaya
  // ingest.ts bisa memilih alamat identitas pelanggan yang benar tanpa mengubah arti From
  // (masih dipakai apa adanya untuk penjaga "dari kotak surat sendiri").
  replyTo: EmailAddress | null
  subject: string | null
  waInboxId: string | null
  body: string
  attachments: string[]
}

function decodeBytes(bytes: Buffer, charset: string): string {
  try {
    return new TextDecoder(charset.trim().toLowerCase()).decode(bytes)
  } catch {
    // Charset yang tidak dikenal TextDecoder: UTF-8 lebih baik daripada membuang isinya.
    return bytes.toString('utf8')
  }
}

/**
 * RFC 2047. Idempoten: teks yang sudah terdekode tidak mengandung pola `=?...?=`, jadi aman
 * dipanggil walau Gmail API ternyata sudah mendekode headernya lebih dulu.
 */
export function decodeMimeWords(value: string): string {
  return value
    // Spasi DI ANTARA dua encoded-word dibuang (RFC 2047 §6.2), bukan bagian dari teks.
    .replace(/\?=\s+=\?/g, '?==?')
    .replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_whole, charset: string, encoding: string, text: string) => {
      const bytes = encoding.toUpperCase() === 'B'
        ? Buffer.from(text, 'base64')
        : Buffer.from(
            text.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16))),
            'latin1',
          )
      return decodeBytes(bytes, charset)
    })
}

/**
 * Satu alamat, bukan daftar. `,` dan `;` ditolak eksplisit (bukan hanya diandalkan pada gagalnya
 * pola regex): bentuk angle `<a@x.com,b@y.com>` lolos pola aslinya sebagai SATU alamat karena
 * kelas karakternya hanya membuang `<>` dan spasi, bukan koma -- hasilnya identitas ber-koma dan
 * `To:` dua penerima sekaligus saat dipakai balas (temuan review).
 */
export function parseAddress(value: string): EmailAddress | null {
  const decoded = decodeMimeWords(value).trim()
  const angled = decoded.match(/^(.*?)<([^<>\s]+@[^<>\s]+)>\s*$/)
  if (angled) {
    const address = angled[2]
    if (address.includes(',') || address.includes(';')) return null
    const name = angled[1].trim().replace(/^"(.*)"$/, '$1').trim()
    return { address: address.toLowerCase(), name: name || null }
  }
  if (decoded.includes(',') || decoded.includes(';')) return null
  return /^[^\s<>@]+@[^\s<>@]+$/.test(decoded) ? { address: decoded.toLowerCase(), name: null } : null
}

/**
 * Header Reply-To bisa memuat beberapa alamat dipisah koma (RFC 5322 §3.6.3). Ambil yang
 * pertama saja -- balasan hanya bisa dikirim ke satu alamat.
 */
function firstAddress(headerValue: string): EmailAddress | null {
  return parseAddress(headerValue.split(',')[0] ?? '')
}

function decodeEntities(text: string): string {
  const named: Record<string, string> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code.startsWith('#')) {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole
    }
    return named[code.toLowerCase()] ?? whole
  })
}

const FORWARD_MARKER = /Forwarded message|Pesan yang diteruskan|Pesan terusan/i

export function htmlToText(html: string): string {
  let source = html.replace(/<(style|script|head)\b[\s\S]*?<\/\1>/gi, '')
  // Email TERUSAN memakai wadah gmail_quote yang sama dengan kutipan balasan, padahal isinya
  // justru pokok emailnya. Membuangnya berarti operator melihat "FYI" tanpa apa pun di bawahnya.
  if (!FORWARD_MARKER.test(source)) {
    source = source
      .replace(/<div[^>]*class="[^"]*gmail_quote[^"]*"[\s\S]*$/i, '')
      .replace(/<blockquote\b[\s\S]*?<\/blockquote>/gi, '')
  }
  const flattened = source
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6]|table)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
  return decodeEntities(flattened)
    .replace(/\r/g, '')
    .replace(/\u00A0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function header(headers: GmailHeader[] | undefined, name: string): string | null {
  const lower = name.toLowerCase()
  return headers?.find((h) => h.name.toLowerCase() === lower)?.value ?? null
}

function charsetOf(part: GmailMessagePart): string {
  return header(part.headers, 'Content-Type')?.match(/charset="?([^";\s]+)"?/i)?.[1] ?? 'utf-8'
}

interface BodyAccumulator {
  plain: string | null
  html: string | null
  attachments: string[]
}

function walk(part: GmailMessagePart, acc: BodyAccumulator): void {
  if (part.filename) {
    acc.attachments.push(part.filename)
    return
  }
  const data = part.body?.data
  if (data && part.mimeType === 'text/plain' && acc.plain === null) {
    const text = decodeBytes(Buffer.from(data, 'base64url'), charsetOf(part))
    if (text.trim()) acc.plain = text
  } else if (data && part.mimeType === 'text/html' && acc.html === null) {
    acc.html = decodeBytes(Buffer.from(data, 'base64url'), charsetOf(part))
  }
  for (const child of part.parts ?? []) walk(child, acc)
}

export function parseGmailMessage(message: GmailMessage): ParsedEmail {
  const headers = message.payload?.headers
  const acc: BodyAccumulator = { plain: null, html: null, attachments: [] }
  if (message.payload) walk(message.payload, acc)

  const fromHeader = header(headers, 'From')
  const replyToHeader = header(headers, 'Reply-To')
  const subject = header(headers, 'Subject')

  return {
    id: message.id,
    threadId: message.threadId,
    labelIds: message.labelIds ?? [],
    sentAt: new Date(Number(message.internalDate ?? Date.now())),
    from: fromHeader ? parseAddress(fromHeader) : null,
    replyTo: replyToHeader ? firstAddress(replyToHeader) : null,
    subject: subject ? decodeMimeWords(subject).trim() || null : null,
    waInboxId: header(headers, WA_INBOX_ID_HEADER),
    body: acc.plain ?? (acc.html ? htmlToText(acc.html) : ''),
    attachments: acc.attachments,
  }
}
