/**
 * Buang riwayat terkutip, signature, dan footer ponsel sebelum isi email ditulis ke
 * Message.content (spec §6.3). Tanpa ini, draf yang dibuat dari email keempat dalam satu
 * benang menjawab pertanyaan dari email pertama -- karena keempat email itu ikut terkutip.
 *
 * Dua pengaman yang sengaja dipasang:
 * - Email TERUSAN tidak pernah dipotong di dalam blok terusannya: blok "From:/Date:" di sana
 *   adalah isi, bukan kutipan balasan.
 * - Kalau pembersihan menyisakan kosong (email yang seluruhnya kutipan), teks asli dipakai.
 *   Pesan pelanggan yang menghilang lebih buruk daripada pesan yang terlalu panjang.
 */
export const MAX_EMAIL_CONTENT_CHARS = 20_000

const REPLY_HEADER = [
  /^On .{1,300}wrote:\s*$/i,
  /^Pada .{1,300}menulis:\s*$/i,
  /^-{2,}\s*(Original Message|Pesan Asli)\s*-{2,}\s*$/i,
]
const OUTLOOK_FROM = /^(From|Dari):\s.+/i
const OUTLOOK_NEXT = /^(Sent|Date|Dikirim|Tanggal|To|Kepada):\s/i
const MOBILE_FOOTER = /^(Sent from my |Dikirim dari )/i
const SIGNATURE_DELIMITER = /^--\s?$/
const FORWARD_MARKER = /^-{2,}\s*(Forwarded message|Pesan yang diteruskan|Pesan terusan)\s*-{2,}\s*$/i

function isReplyHeader(line: string): boolean {
  return REPLY_HEADER.some((re) => re.test(line))
}

export function cleanEmailBody(raw: string): string {
  const normalized = raw.replace(/\r\n?/g, '\n')
  const lines = normalized.split('\n')
  const kept: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    if (FORWARD_MARKER.test(trimmed)) {
      kept.push(...lines.slice(i))
      break
    }
    if (isReplyHeader(trimmed)) break
    // Gmail membungkus "On <tanggal> <nama> <alamat> wrote:" jadi dua baris kalau panjang.
    if (/^(On|Pada)\s/i.test(trimmed) && isReplyHeader(`${trimmed} ${(lines[i + 1] ?? '').trim()}`)) break
    if (OUTLOOK_FROM.test(trimmed) && lines.slice(i + 1, i + 4).some((l) => OUTLOOK_NEXT.test(l.trim()))) break
    if (SIGNATURE_DELIMITER.test(line) || MOBILE_FOOTER.test(trimmed)) break
    if (trimmed.startsWith('>')) continue
    kept.push(line)
  }

  let cleaned = kept.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  if (!cleaned) cleaned = normalized.trim()
  if (cleaned.length > MAX_EMAIL_CONTENT_CHARS) {
    cleaned = `${cleaned.slice(0, MAX_EMAIL_CONTENT_CHARS)}\n…[dipotong — buka di Gmail untuk isi lengkap]`
  }
  return cleaned
}
