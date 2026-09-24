import type { Platform } from '@prisma/client'
import { prisma } from '@/lib/db'

/**
 * Satu-satunya penulis tabel ChannelIdentity.
 *
 * Kuncinya SELALU pasangan (platform, externalId), tidak pernah externalId saja: nomor
 * WhatsApp dan PSID Facebook sama-sama string angka dan bisa bertabrakan. Kalau platform
 * tidak ikut jadi kunci, pesan Facebook menempel ke kontak WhatsApp orang lain dan riwayat
 * dua orang asing tergabung tanpa ada yang menyadarinya.
 *
 * `displayName` tidak ikut ditulis saat pemanggil tidak membawanya -- mengirim `undefined`
 * ke Prisma akan dihitung sebagai "jangan ubah", tapi menulisnya eksplisit sebagai `null`
 * akan menghapus nama yang sudah tersimpan dari giliran sebelumnya.
 */
export async function upsertChannelIdentity(input: {
  platform: Platform
  externalId: string
  contactId: string
  displayName?: string | null
}): Promise<{ id: string; contactId: string }> {
  const { platform, externalId, contactId, displayName } = input

  return prisma.channelIdentity.upsert({
    where: { platform_externalId: { platform, externalId } },
    update: displayName ? { displayName } : {},
    create: { platform, externalId, contactId, displayName: displayName ?? null },
    select: { id: true, contactId: true },
  })
}
