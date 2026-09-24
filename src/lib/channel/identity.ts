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
 *
 * `contactId` ikut dikembalikan karena ia BELUM TENTU sama dengan `input.contactId`: kalau
 * baris identitasnya sudah ada, cabang `update` tidak menyentuh `contactId`, jadi yang keluar
 * adalah pemilik yang sudah terikat -- bukan Contact yang baru saja dibuat pemanggil. Setelah
 * Task 9 melepas `Contact.phone @unique`, dua pesan pertama yang nyaris bersamaan dari nomor
 * baru yang sama sama-sama tidak menemukan identitas dan sama-sama membuat Contact (A dan B);
 * identitas terikat ke salah satunya saja. Setiap pemanggil WAJIB memakai nilai balik ini
 * sebagai `Conversation.contactId`, bukan `contact.id` miliknya sendiri -- kalau tidak,
 * `Conversation.contactId` dan `ChannelIdentity.contactId` menunjuk Contact berbeda selamanya,
 * dan `src/app/api/send/route.ts` (cari kontak lewat `phone`, `orderBy: createdAt asc`) memilih
 * Contact yang tidak punya percakapan lalu menjawab 404 "Percakapan tidak ditemukan" untuk
 * nomor yang thread-nya jelas terlihat di Inbox.
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
