/**
 * Bahasa kabar otomatis ke tamu (tanda terima, "sudah diperbarui", permintaan data). Owner 2026-10-21: tamu menulis
 * Inggris tapi dijawab Indonesia karena negaranya di booking "Indonesia". Aturannya kini: bahasa CHAT tamu yang menang;
 * negara di booking (`isIndonesianGuest`) hanya cadangan bila chatnya tidak jelas (hanya angka/nama tempat, campur rata).
 *
 * Deteksi sengaja sederhana dan tanpa LLM: hitung kata fungsi yang khas tiap bahasa. Kata yang dipakai kedua bahasa
 * (hotel, pickup, ok, noted, jam angka) tidak dihitung. Seri/kosong = null.
 */
import { prisma } from '@/lib/db'
import type { BookingData } from '@/lib/booking/client'

export type GuestLang = 'en' | 'id'

/** Tamu Indonesia menurut booking (`guestDetails.country` memuat "indonesia"); cadangan bila chat tidak jelas. */
export function isIndonesianGuest(booking: BookingData): boolean {
  const country = booking.guestDetails?.country
  return typeof country === 'string' && /indonesia/i.test(country)
}

const ID_WORDS = new Set([
  'yang', 'dan', 'saya', 'aku', 'kami', 'kita', 'ini', 'itu', 'mau', 'ingin', 'tolong', 'mohon', 'bisa', 'jemput', 'jemputan',
  'antar', 'ganti', 'ubah', 'diubah', 'tidak', 'nggak', 'gak', 'enggak', 'sudah', 'udah', 'belum', 'apakah', 'apa', 'dengan',
  'untuk', 'di', 'ke', 'dari', 'terima', 'kasih', 'makasih', 'bapak', 'ibu', 'kak', 'pak', 'bu', 'mas', 'mbak', 'aja', 'saja',
  'dong', 'ya', 'iya', 'kaos', 'ukuran', 'besok', 'nanti', 'jadi', 'kalau', 'kalo', 'atau', 'juga', 'ada', 'gimana', 'bagaimana',
  'berapa', 'kapan', 'mana', 'dimana', 'lagi', 'pagi', 'siang', 'sore', 'malam', 'orang', 'baju', 'selamat', 'halo',
])

const EN_WORDS = new Set([
  'the', 'is', 'are', 'my', 'i', 'we', 'our', 'you', 'your', 'want', 'would', 'could', 'can', 'please', 'change', 'to', 'at',
  'from', 'and', 'just', 'confirm', 'if', 'location', 'hello', 'hi', 'thanks', 'thank', 'need', 'like', 'shirt', 't-shirt',
  'size', 'sizes', 'time', 'tomorrow', 'will', 'be', 'it', 'this', 'that', 'of', 'for', 'with', 'instead', 'not', 'do', 'does',
  'have', 'has', 'what', 'when', 'where', 'how', 'morning', 'evening', 'am', 'pm', 'people', 'pick', 'up', 'drop', 'off',
])

/** Bahasa sekumpulan teks tamu, atau null bila tidak bisa diputuskan. Murni. */
export function textLanguage(texts: readonly (string | null | undefined)[]): GuestLang | null {
  let id = 0
  let en = 0
  for (const t of texts) {
    if (!t) continue
    for (const word of t.toLowerCase().match(/[a-z][a-z'-]*/g) ?? []) {
      if (ID_WORDS.has(word)) id++
      if (EN_WORDS.has(word)) en++
    }
  }
  if (id === en) return null
  return id > en ? 'id' : 'en'
}

/** Bahasa kabar ke tamu: chat tamu dulu, lalu negara di booking. Murni. */
export function guestLanguage(booking: BookingData, guestTexts: readonly (string | null | undefined)[] = []): GuestLang {
  return textLanguage(guestTexts) ?? (isIndonesianGuest(booking) ? 'id' : 'en')
}

/** Isi pesan teks TAMU terbaru di percakapan (terbaru dulu); gagal baca = [] (cadangan negara yang dipakai). */
export async function recentGuestTexts(conversationId: string, limit = 5): Promise<string[]> {
  try {
    const rows =
      (await prisma.message.findMany({
        where: { conversationId, direction: 'INBOUND', content: { not: null } },
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: { content: true },
      })) ?? []
    return rows.flatMap((r) => (r.content ? [r.content] : []))
  } catch {
    return []
  }
}
