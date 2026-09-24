import type { Platform } from '@prisma/client'

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
