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
