/**
 * Penyaring "bukan pertanyaan" untuk antrean live (`createLiveReplyItems`): reaksi emoji dan
 * pesan penutup murni ("ok", "thanks", "terima kasih kak", 👍) tidak menunggu balasan apa pun.
 *
 * Tidak ada pendeteksi serupa di repo: job 00:00 menyerahkan penilaian ini ke LLM (status
 * "selesai" di src/lib/daily-summary/review.ts), sedangkan tick live tidak boleh memanggil LLM.
 * Karena itu aturannya SENGAJA sempit -- salah menganggap pertanyaan sebagai penutup berarti
 * pelanggan hilang dari antrean, sedangkan penutup yang lolos hanya jadi satu kartu yang
 * ditutup `JUDGED_DONE` oleh job malam. Kalau ragu, bukan penutup.
 *
 * - Ada "?" → bukan penutup ("ok?" adalah tagihan, bukan penutup).
 * - Tanpa teks (gambar/dokumen/voice tanpa caption) → bukan penutup: bisa bukti transfer.
 * - Hanya emoji/tanda baca → penutup.
 * - Selain itu setiap kata harus ada di kosakata penutup/pengisi, minimal satu kata inti, dan
 *   maksimal MAX_WORDS kata. "ya"/"yes" sendirian TIDAK termasuk: itu jawaban atas pertanyaan
 *   kita dan menunggu langkah berikutnya.
 */

export type NoiseMessage = { type: string; content: string | null }

const MAX_WORDS = 6

/** Kata yang sendirian sudah berarti "terima kasih / oke / dicatat". */
const CORE = new Set([
  'ok', 'oke', 'okey', 'okay', 'okee', 'okeh', 'sip', 'siap', 'noted', 'baik', 'alright',
  'thanks', 'thank', 'thankyou', 'thanku', 'thx', 'thnx', 'tks', 'tq', 'ty', 'tysm',
  'makasih', 'makasi', 'mksh', 'mksih', 'terimakasih', 'trimakasih', 'trims', 'matur', 'nuwun', 'suwun',
])

/** Kata pengisi yang boleh menempel pada kata inti, tidak pernah cukup sendirian. */
const FILLER = new Set([
  'you', 'u', 'very', 'much', 'so', 'a', 'lot', 'many', 'all', 'again', 'sir', 'madam', 'bro', 'sis',
  'kak', 'ka', 'kakak', 'mas', 'mba', 'mbak', 'pak', 'bu', 'gan', 'min', 'admin',
  'kk', 'ya', 'yaa', 'yah', 'yes', 'banyak', 'sekali',
])

/** Emoji, modifier warna kulit, ZWJ, variation selector, tanda baca, dan simbol. */
const NON_TEXT = /[\p{Extended_Pictographic}\p{Emoji_Modifier}\u200d\ufe0f\p{P}\p{S}\s]/gu

export function isNoiseMessage(message: NoiseMessage): boolean {
  if (message.type === 'reaction') return true
  const text = message.content?.trim() ?? ''
  if (!text || text.includes('?') || text.includes('\uff1f')) return false
  if (text.replace(NON_TEXT, '') === '') return true

  const words = text
    .toLowerCase()
    .replace(/terima\s+kasih/g, 'terimakasih')
    .replace(/thank\s+you/g, 'thankyou')
    // "okkk", "thanksss", "siappp" → bentuk dasarnya.
    .replace(/(\p{L})\1{2,}/gu, '$1')
    .replace(NON_TEXT, ' ')
    .split(' ')
    .filter(Boolean)
  if (words.length === 0 || words.length > MAX_WORDS) return false
  return words.some((w) => CORE.has(w)) && words.every((w) => CORE.has(w) || FILLER.has(w))
}
