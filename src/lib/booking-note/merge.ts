/**
 * Menggabungkan note dari chat WA ke `bookings.note` (owner 2026-11-13). Murni, tanpa I/O.
 *
 * Aturan yang tidak boleh dilanggar: TULISAN ADMIN TIDAK PERNAH HILANG. Bagian admin = `note` sekarang tanpa blok
 * "— Dari chat WA —" milik kita, dan ditulis kembali UTUH. Yang boleh diganti hanya blok kita sendiri.
 *
 * `state` (kolom `bookings.note_wa`) mengingat apa yang terakhir kita tulis, sehingga `note` bisa dibongkar lagi:
 * - `lines`: baris blok yang terakhir kita tulis.
 * - `dismissed`: baris kita yang dihapus admin DI DALAM blok; tidak ditulis ulang.
 * - `prev`: isi `note` utuh sebelum penulisan terakhir (pemulihan).
 *
 * Dihapus admin = judul blok masih ada tetapi barisnya berkurang. Bila judul blok hilang seluruhnya, note ditimpa jalur
 * lain (import Excel, form lama, modal plotting), BUKAN keputusan admin: blok ditulis lagi, `dismissed` tidak bertambah.
 * Baris yang admin ketik atau ubah di dalam blok adalah tulisan admin: dipindah ke bagian admin, tidak dibuang.
 * Dedup berlapis: frasa utuh dan kata bermakna (angka dan kata umum diabaikan) yang sudah ada di bagian admin.
 * Batasan: admin yang sengaja menghapus judul beserta seluruh blok tidak bisa dibedakan dari penimpaan.
 */

export const WA_NOTE_HEADER = '— Dari chat WA —'
const MAX_DISMISSED = 50

export type WaNoteState = { lines: string[]; dismissed: string[]; prev: string | null; at: string }
export type MergeResult = { note: string | null; state: WaNoteState; changed: boolean }

/** Legacy `booking-overview` memilih warna note dengan `str_contains(strtolower(note), 'confirm')`: blok kita tidak boleh memuatnya. */
const CONFIRM_RE = /confirm/i

/** Kata yang tidak membawa makna sendiri ("2 tamu vegan" dan "VEGAN" sama maknanya); angka murni juga dibuang. */
const FILLER = new Set(['tamu', 'orang', 'peserta', 'minta', 'meminta', 'perlu', 'butuh', 'membutuhkan', 'ingin', 'mau', 'pax', 'dan', 'yang', 'untuk', 'dari', 'ke', 'di', 'ada', 'the', 'and', 'a', 'of', 'guest', 'guests', 'wants', 'need', 'needs'])

const norm = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
const contentWords = (s: string): string[] => norm(s).split(' ').filter((w) => w && !FILLER.has(w) && !/^\d+$/.test(w))
const stripBullet = (s: string): string => s.replace(/^\s*[-•*]\s*/, '').trim()
const eol = (s: string): string => s.replace(/\r\n/g, '\n').trim()

export function mergeScheduleNote(args: { current: string | null; state: WaNoteState | null; incoming: string[]; at: Date }): MergeResult {
  const { current, state, incoming, at } = args
  const text = current ?? ''
  const rows = text.split('\n')
  let headerAt = -1
  rows.forEach((row, i) => {
    if (row.trim() === WA_NOTE_HEADER) headerAt = i
  })

  const adminBefore = (headerAt >= 0 ? rows.slice(0, headerAt).join('\n') : text).trim()
  const blockLines = headerAt >= 0 ? rows.slice(headerAt + 1).map(stripBullet).filter(Boolean) : []

  const prevLines = state?.lines ?? []
  const prevNorm = new Set(prevLines.map(norm))
  const blockNorm = new Set(blockLines.map(norm))
  // Baris di blok yang bukan kita yang menulis (diketik atau diubah admin): tulisan admin, dipertahankan.
  const adminInBlock = blockLines.filter((l) => !prevNorm.has(norm(l)))
  // Baris kita yang hilang dari blok yang judulnya masih ada: admin menghapusnya.
  const removed = headerAt >= 0 ? prevLines.filter((l) => !blockNorm.has(norm(l))) : []
  const dismissed = [...new Map([...(state?.dismissed ?? []), ...removed].map((l) => [norm(l), l])).values()].slice(-MAX_DISMISSED)

  const adminPart = [adminBefore, ...adminInBlock.map((l) => `- ${l}`)].filter(Boolean).join('\n')
  const adminWords = ` ${norm(adminPart)} `
  const adminWordSet = new Set(norm(adminPart).split(' '))
  const dismissedNorm = new Set(dismissed.map(norm))

  const lines: string[] = []
  const seen = new Set<string>()
  for (const raw of incoming) {
    const line = stripBullet(raw).replace(/\s+/g, ' ')
    const n = norm(line)
    if (!line || !n || seen.has(n)) continue
    if (CONFIRM_RE.test(line) || dismissedNorm.has(n) || adminWords.includes(` ${n} `)) continue
    // Semua kata bermakna sudah ditulis admin ("2 tamu vegan" vs "VEGAN"): sama maknanya, tidak diulang.
    const content = contentWords(line)
    if (content.length > 0 && content.every((w) => adminWordSet.has(w))) continue
    seen.add(n)
    lines.push(line)
  }

  const block = lines.length > 0 ? `${WA_NOTE_HEADER}\n${lines.map((l) => `- ${l}`).join('\n')}` : ''
  const note = [adminPart, block].filter(Boolean).join('\n\n') || null
  const changed = eol(note ?? '') !== eol(text)
  return {
    note,
    changed,
    state: { lines, dismissed, prev: changed ? current : (state?.prev ?? null), at: at.toISOString() },
  }
}
