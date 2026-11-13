/**
 * Menggabungkan note dari chat WA ke `bookings.note` (owner 2026-11-13). Murni, tanpa I/O.
 *
 * Aturan yang tidak boleh dilanggar: TULISAN ADMIN TIDAK PERNAH HILANG. Baris dari chat WA ditulis sebagai butir
 * "- ..." biasa di akhir note, TANPA judul atau penanda yang terlihat (owner 2026-11-13). Karena itu baris kita dikenali
 * dari `state` (kolom `bookings.note_wa`), yang mengingat apa yang terakhir kita tulis:
 * - `lines`: butir yang terakhir kita tulis.
 * - `admin`: bagian admin pada penulisan terakhir (untuk membedakan "admin menghapus butir kita" dari "note ditimpa").
 * - `dismissed`: butir kita yang dihapus admin; tidak ditulis ulang.
 * - `prev`: isi `note` utuh sebelum penulisan terakhir (pemulihan).
 *
 * Bagian admin = `note` sekarang tanpa butir yang persis sama dengan `lines` terakhir kita. Ia ditulis kembali dengan
 * isi dan urutan barisnya utuh; butir kita selalu diletakkan di akhir.
 *
 * Dihapus admin = sebagian butir kita masih ada tetapi sebagian hilang; atau semuanya hilang sementara bagian admin
 * masih utuh (atau note dikosongkan). Bila semua butir hilang DAN bagian admin tidak lagi sama, note ditimpa jalur lain
 * (import Excel, form lama, modal plotting), BUKAN keputusan admin: butir ditulis lagi, `dismissed` tidak bertambah.
 * Butir yang admin ubah kalimatnya adalah tulisan admin: tetap di bagian admin, versi lama kita masuk `dismissed`.
 * Dedup berlapis: frasa utuh dan kata bermakna (angka dan kata umum diabaikan) yang sudah ada di bagian admin.
 * Batasan: tanpa `state.admin` (backoffice lama), semua butir hilang dibaca sebagai penimpaan.
 *
 * Format lama (judul "— Dari chat WA —", sampai 2026-11-13) masih dibaca: judul itu dibuang dan butirnya diubah ke format baru.
 */

/** Judul format lama; hanya dikenali untuk dibuang, tidak pernah ditulis lagi. */
const LEGACY_HEADER = '— Dari chat WA —'
const MAX_DISMISSED = 50

export type WaNoteState = { lines: string[]; dismissed: string[]; prev: string | null; at: string; admin?: string | null }
export type MergeResult = { note: string | null; state: WaNoteState; changed: boolean }

/** Legacy `booking-overview` memilih warna note dengan `str_contains(strtolower(note), 'confirm')`: butir kita tidak boleh memuatnya. */
const CONFIRM_RE = /confirm/i

/** Kata yang tidak membawa makna sendiri ("2 tamu vegan" dan "VEGAN" sama maknanya); angka murni juga dibuang. */
const FILLER = new Set(['tamu', 'orang', 'peserta', 'minta', 'meminta', 'perlu', 'butuh', 'membutuhkan', 'ingin', 'mau', 'pax', 'dan', 'yang', 'untuk', 'dari', 'ke', 'di', 'ada', 'the', 'and', 'a', 'of', 'guest', 'guests', 'wants', 'need', 'needs'])

const norm = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
const contentWords = (s: string): string[] => norm(s).split(' ').filter((w) => w && !FILLER.has(w) && !/^\d+$/.test(w))
const stripBullet = (s: string): string => s.replace(/^\s*[-•*]\s*/, '').trim()
const isBullet = (s: string): boolean => /^\s*[-•*]\s*\S/.test(s)
const eol = (s: string): string => s.replace(/\r\n/g, '\n').trim()

export function mergeScheduleNote(args: { current: string | null; state: WaNoteState | null; incoming: string[]; at: Date }): MergeResult {
  const { current, state, incoming, at } = args
  const text = current ?? ''
  const rows = text.split('\n')
  const prevLines = state?.lines ?? []
  const prevNorm = new Set(prevLines.map(norm))

  // Butir kita = baris berbutir yang kalimatnya persis sama dengan yang terakhir kita tulis. Judul format lama dibuang.
  const presentNorm = new Set<string>()
  const adminRows = rows.filter((row) => {
    if (row.trim() === LEGACY_HEADER) return false
    if (isBullet(row) && prevNorm.has(norm(stripBullet(row)))) {
      presentNorm.add(norm(stripBullet(row)))
      return false
    }
    return true
  })
  const adminPart = adminRows.join('\n').trim()

  const missing = prevLines.filter((l) => !presentNorm.has(norm(l)))
  let removed: string[] = []
  if (missing.length > 0) {
    if (presentNorm.size > 0) removed = missing // sebagian butir masih ada: yang hilang dihapus admin
    else if (text.trim() === '') removed = missing // note dikosongkan admin
    else if (state?.admin != null && state.admin !== '' && eol(adminPart).includes(eol(state.admin))) removed = missing // bagian admin utuh, butir kita dihapus
    // selain itu: note ditimpa jalur lain, bukan keputusan admin
  }
  const dismissed = [...new Map([...(state?.dismissed ?? []), ...removed].map((l) => [norm(l), l])).values()].slice(-MAX_DISMISSED)

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

  const note = [adminPart, lines.map((l) => `- ${l}`).join('\n')].filter(Boolean).join('\n') || null
  const changed = eol(note ?? '') !== eol(text)
  return {
    note,
    changed,
    state: { lines, dismissed, prev: changed ? current : (state?.prev ?? null), at: at.toISOString(), admin: adminPart },
  }
}
