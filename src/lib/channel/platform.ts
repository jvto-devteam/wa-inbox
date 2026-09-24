import type { Platform, Settings } from '@prisma/client'

/**
 * Satu-satunya tempat yang menjawab "platform ini identitasnya nomor telepon atau bukan".
 *
 * Ada sebagai tabel eksplisit, bukan sebagai pengecekan regex di tempat pemakaian, karena
 * IGSID dan PSID adalah angka panjang: regex `/^62\d+$/` di src/lib/phone.ts kebetulan tidak
 * mencocokinya, jadi filter nomor Indonesia akan tampak berlaku di Instagram/Facebook padahal
 * tidak pernah sekali pun mengenai apa-apa. Kegagalan senyap seperti itu tidak pernah
 * dilaporkan siapa pun.
 */
export const ALL_PLATFORMS = ['WHATSAPP', 'INSTAGRAM', 'FACEBOOK', 'EMAIL'] as const satisfies readonly Platform[]

const PHONE_BASED: ReadonlySet<Platform> = new Set<Platform>(['WHATSAPP'])

export function hasPhoneNumber(platform: Platform): boolean {
  return PHONE_BASED.has(platform)
}

/**
 * Kolom `Settings` yang menyimpan sakelar bot untuk tiap platform.
 *
 * Satu salinan, di sini, karena tiga pihak membutuhkannya dan ketiganya harus setuju:
 * `defaultBotEnabled` (src/lib/inbound.ts, saat percakapan lahir),
 * `POST /api/bot/channel-toggle` (penulis massal per channel), dan `POST /api/bot/mode`
 * (sakelar global, yang harus menghormati sakelar tiap platform saat menyalakan). Peta yang
 * disalin tiga kali adalah peta yang cepat atau lambat berselisih -- dan selisihnya berupa
 * sakelar di layar yang tidak cocok dengan perilaku bot, persis kelas bug yang sudah terjadi.
 */
export const BOT_TOGGLE_COLUMN_BY_PLATFORM = {
  WHATSAPP: 'botEnabledWhatsapp',
  INSTAGRAM: 'botEnabledInstagram',
  FACEBOOK: 'botEnabledFacebook',
  EMAIL: 'botEnabledEmail',
} as const satisfies Record<Platform, keyof Settings>

/**
 * Platform yang tabnya ditampilkan di Inbox — bertambah SATU entri per fase channel.
 *
 * Sengaja konstanta, bukan diturunkan dari isi tabel: kalau diturunkan dari data, tab
 * Facebook baru muncul saat pesan Facebook PERTAMA tiba, jadi operator tidak punya cara
 * melihat channel itu sudah hidup sebelum ada yang menulis — dan tab yang berkedip mengikuti
 * isi tabel membuat orang ragu apakah ia salah lihat.
 *
 * Tab kosong lebih buruk daripada tidak ada tab: ia menjanjikan sesuatu yang tidak bisa
 * diberikan, dan tidak bisa dibedakan dari channel yang rusak. Karena itu Instagram dan
 * Email TIDAK ada di sini sampai fasenya benar-benar selesai.
 */
export const SHIPPED_PLATFORMS = ['WHATSAPP', 'FACEBOOK'] as const satisfies readonly Platform[]

export const PLATFORM_LABEL: Record<Platform, string> = {
  WHATSAPP: 'WhatsApp',
  INSTAGRAM: 'Instagram',
  FACEBOOK: 'Facebook',
  EMAIL: 'Email',
}
