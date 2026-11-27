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

/**
 * Identitas WhatsApp dengan dua kunci: nomor (`phone`, `externalId`) dan `bsuid` (ID pengguna dari Meta).
 *
 * Sejak pengguna WhatsApp bisa memakai username (2026), Meta tidak selalu mengirim nomor: webhook hanya membawa
 * `from_user_id`/`user_id`/`to_user_id`. Nomor ikut hanya bila bisnis pernah bertukar pesan dengan nomor itu dalam 30 hari
 * atau nomornya ada di buku kontak (https://developers.facebook.com/documentation/business-messaging/whatsapp/business-scoped-user-ids).
 * Kode lama memakai nomor sebagai satu-satunya kunci, sehingga pesan tanpa nomor dijawab 500 dan hilang (27 Nov 2026).
 *
 * Aturan satu orang = satu identitas:
 * - Tanpa `bsuid` (webhook lama / nomor saja): persis `upsertChannelIdentity` -- tidak ada kueri tambahan.
 * - Nomor + `bsuid`: identitas ber-nomor menang. Bila yang ada baru identitas tanpa nomor (externalId = bsuid), ia
 *   DINAIKKAN: externalId jadi nomor dan `Contact.phone` diisi -- chat, riwayat, dan kontaknya tetap satu. Bila `bsuid` itu
 *   sudah dipegang baris lain yang juga ber-nomor, dua baris dibiarkan (menggabungkan percakapan tidak bisa dibatalkan) dan
 *   dicatat di log.
 * - Hanya `bsuid`: dicari lewat `bsuid`; belum ada = dibuat dengan externalId = bsuid (kolom wajib dan unik) dan
 *   `Contact.phone` null.
 */
export type WhatsappKeys = { phone?: string | null; bsuid?: string | null }

/** Contact pemilik identitas WhatsApp itu (cari lewat nomor dulu, lalu bsuid), atau null bila belum pernah ada. */
export async function findWhatsappContactId(keys: WhatsappKeys): Promise<string | null> {
  if (keys.phone) {
    const byPhone = await prisma.channelIdentity.findUnique({
      where: { platform_externalId: { platform: 'WHATSAPP', externalId: keys.phone } },
      select: { contactId: true },
    })
    if (byPhone) return byPhone.contactId
  }
  if (keys.bsuid) {
    const byBsuid = await prisma.channelIdentity.findUnique({
      where: { platform_bsuid: { platform: 'WHATSAPP', bsuid: keys.bsuid } },
      select: { contactId: true },
    })
    if (byBsuid) return byBsuid.contactId
  }
  return null
}

export async function upsertWhatsappIdentity(input: WhatsappKeys & { contactId: string; displayName?: string | null }): Promise<{ id: string; contactId: string }> {
  const { phone, bsuid, contactId, displayName } = input
  if (!phone && !bsuid) throw new Error('upsertWhatsappIdentity: butuh nomor atau bsuid')
  if (!bsuid) return upsertChannelIdentity({ platform: 'WHATSAPP', externalId: phone as string, contactId, displayName })

  const byBsuid = await prisma.channelIdentity.findUnique({
    where: { platform_bsuid: { platform: 'WHATSAPP', bsuid } },
    select: { id: true, contactId: true, externalId: true },
  })

  if (!phone) {
    if (byBsuid) {
      if (displayName) await prisma.channelIdentity.update({ where: { id: byBsuid.id }, data: { displayName } })
      return { id: byBsuid.id, contactId: byBsuid.contactId }
    }
    const create = () =>
      prisma.channelIdentity.create({
        data: { platform: 'WHATSAPP', externalId: bsuid, bsuid, contactId, displayName: displayName ?? null },
        select: { id: true, contactId: true },
      })
    try {
      return await create()
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        // Balapan: pesan pertama yang nyaris bersamaan. Barisnya sudah ditulis yang menang.
        const won = await prisma.channelIdentity.findUnique({
          where: { platform_bsuid: { platform: 'WHATSAPP', bsuid } },
          select: { id: true, contactId: true },
        })
        if (won) return won
      }
      throw error
    }
  }

  // Ada nomor dan bsuid.
  if (byBsuid && byBsuid.externalId !== phone) {
    const byPhone = await prisma.channelIdentity.findUnique({
      where: { platform_externalId: { platform: 'WHATSAPP', externalId: phone } },
      select: { id: true, contactId: true },
    })
    if (!byPhone) {
      // Nomornya baru muncul: identitas tanpa nomor dinaikkan jadi identitas ber-nomor.
      await prisma.channelIdentity.update({ where: { id: byBsuid.id }, data: { externalId: phone, ...(displayName ? { displayName } : {}) } })
      await prisma.contact.updateMany({ where: { id: byBsuid.contactId, phone: null }, data: { phone } })
      return { id: byBsuid.id, contactId: byBsuid.contactId }
    }
    // Dua identitas untuk orang yang sama: tidak digabung otomatis (tidak bisa dibatalkan). Chat ber-nomor yang dipakai.
    console.warn('upsertWhatsappIdentity: identitas ganda (bsuid dan nomor milik baris berbeda), tidak digabung', {
      bsuidIdentityId: byBsuid.id,
      phoneIdentityId: byPhone.id,
    })
    return byPhone
  }

  const identity = await upsertChannelIdentity({ platform: 'WHATSAPP', externalId: phone, contactId, displayName })
  // Catat bsuid-nya (sekali): pesan tanpa nomor berikutnya dari orang ini -- mis. sesudah ia memakai username -- akan
  // menemukan chat yang sama. updateMany bersyarat: tidak menimpa, tidak melempar bila baris lain sudah memegang bsuid itu.
  await prisma.channelIdentity.updateMany({ where: { id: identity.id, bsuid: null }, data: { bsuid } }).catch((error: unknown) => {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error
  })
  return identity
}
