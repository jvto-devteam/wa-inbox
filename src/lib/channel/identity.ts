import { Prisma, type Platform } from '@prisma/client'
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
 *
 * `upsert` Prisma BUKAN atomik terhadap balapan: ia SELECT dulu, lalu INSERT. Dua pemanggilan
 * bersamaan untuk (platform, externalId) yang sama sama-sama tidak menemukan baris, sama-sama
 * mencoba INSERT, dan yang kalah menabrak @@unique -> P2002 dilempar ke pemanggil. Di jalur
 * webhook lemparan itu keluar sebagai HTTP 500, dan Meta menganggap 500 sebagai kegagalan lalu
 * mengirim ulang -- balapan yang sama, 500 yang sama, berputar. Terjadi sungguhan di produksi
 * 2026-09-25 pukul 09:34:13 WIB, saat satu Page masih berlangganan ke dua app Meta sekaligus
 * sehingga setiap pesan tiba dua kali dan nyaris bersamaan.
 *
 * Yang kalah balapan TIDAK gagal: barisnya sudah ada (ditulis yang menang), jadi maksud
 * pemanggil sudah terpenuhi. Sekali coba lagi menempuh cabang `update`, mengembalikan pemilik
 * yang benar-benar terikat, dan menutup 500-nya. Percobaan kedua sengaja tidak dilindungi --
 * P2002 dua kali berturut-turut bukan lagi balapan biasa dan harus terlihat, bukan ditelan.
 */
export async function upsertChannelIdentity(input: {
  platform: Platform
  externalId: string
  contactId: string
  displayName?: string | null
}): Promise<{ id: string; contactId: string }> {
  const { platform, externalId, contactId, displayName } = input

  const write = () =>
    prisma.channelIdentity.upsert({
      where: { platform_externalId: { platform, externalId } },
      update: displayName ? { displayName } : {},
      create: { platform, externalId, contactId, displayName: displayName ?? null },
      select: { id: true, contactId: true },
    })

  try {
    return await write()
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return write()
    }
    throw error
  }
}
