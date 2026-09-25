import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import { Prisma, type PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

import { upsertChannelIdentity } from './identity'

beforeEach(() => {
  mockReset(mockPrisma)
})

describe('upsertChannelIdentity', () => {
  it('mencari lewat pasangan (platform, externalId), bukan lewat externalId saja', async () => {
    mockPrisma.channelIdentity.upsert.mockResolvedValue({ id: 'ci_1', contactId: 'c_1' } as never)

    await upsertChannelIdentity({ platform: 'FACEBOOK', externalId: '123', contactId: 'c_1' })

    const arg = mockPrisma.channelIdentity.upsert.mock.calls[0][0]
    expect(arg.where).toEqual({ platform_externalId: { platform: 'FACEBOOK', externalId: '123' } })
  })

  // Nomor WhatsApp dan PSID Facebook bisa kebetulan sama persis sebagai string angka.
  // Tanpa platform ikut jadi kunci, pesan Facebook akan menempel ke kontak WhatsApp
  // orang lain -- dan riwayat dua orang asing tergabung tanpa ada yang menyadarinya.
  it('tidak menimpa identitas platform lain yang externalId-nya kebetulan sama', async () => {
    mockPrisma.channelIdentity.upsert.mockResolvedValue({ id: 'ci_2', contactId: 'c_2' } as never)

    await upsertChannelIdentity({ platform: 'WHATSAPP', externalId: '123', contactId: 'c_2' })

    const arg = mockPrisma.channelIdentity.upsert.mock.calls[0][0] as unknown as { where: { platform_externalId: { platform: string } } }
    expect(arg.where.platform_externalId.platform).toBe('WHATSAPP')
  })

  it('tidak menghapus displayName yang sudah ada saat pemanggil tidak membawanya', async () => {
    mockPrisma.channelIdentity.upsert.mockResolvedValue({ id: 'ci_3', contactId: 'c_3' } as never)

    await upsertChannelIdentity({ platform: 'INSTAGRAM', externalId: 'igsid_9', contactId: 'c_3' })

    const arg = mockPrisma.channelIdentity.upsert.mock.calls[0][0]
    expect(arg.update).toEqual({})
  })

  it('memperbarui displayName saat pemanggil membawanya', async () => {
    mockPrisma.channelIdentity.upsert.mockResolvedValue({ id: 'ci_4', contactId: 'c_4' } as never)

    await upsertChannelIdentity({
      platform: 'INSTAGRAM', externalId: 'igsid_9', contactId: 'c_4', displayName: 'Anna',
    })

    const arg = mockPrisma.channelIdentity.upsert.mock.calls[0][0]
    expect(arg.update).toEqual({ displayName: 'Anna' })
  })

  // Regresi produksi 2026-09-25 09:34:13 WIB: satu Page berlangganan ke dua app Meta, jadi
  // pesan yang sama tiba dua kali nyaris bersamaan. Kedua pemanggilan tidak menemukan baris
  // identitas, keduanya INSERT, yang kalah menabrak @@unique -> P2002 keluar sebagai HTTP 500.
  // Meta memperlakukan 500 sebagai kegagalan dan mengirim ulang, jadi kegagalan ini berputar.
  it('tidak melempar saat kalah balapan INSERT -- mencoba sekali lagi lewat cabang update', async () => {
    const p2002 = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002', clientVersion: '7.0.0',
    })
    mockPrisma.channelIdentity.upsert
      .mockRejectedValueOnce(p2002)
      .mockResolvedValueOnce({ id: 'ci_menang', contactId: 'c_menang' } as never)

    const hasil = await upsertChannelIdentity({
      platform: 'FACEBOOK', externalId: 'psid_1', contactId: 'c_kalah',
    })

    // Pemilik yang dikembalikan adalah Contact milik yang MENANG, bukan Contact yang baru
    // saja dibuat pemanggil ini -- itulah nilai yang wajib dipakai sebagai Conversation.contactId.
    expect(hasil).toEqual({ id: 'ci_menang', contactId: 'c_menang' })
    expect(mockPrisma.channelIdentity.upsert).toHaveBeenCalledTimes(2)
  })

  // P2002 dua kali berturut-turut bukan balapan biasa. Menelannya diam-diam akan menyembunyikan
  // kerusakan constraint yang sesungguhnya.
  it('melempar kalau percobaan kedua juga P2002', async () => {
    const p2002 = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002', clientVersion: '7.0.0',
    })
    mockPrisma.channelIdentity.upsert.mockRejectedValue(p2002)

    await expect(
      upsertChannelIdentity({ platform: 'FACEBOOK', externalId: 'psid_2', contactId: 'c_x' }),
    ).rejects.toThrow('Unique constraint failed')
  })

  // Error selain P2002 tidak boleh ikut dicoba ulang: kalau koneksi DB putus, mencoba lagi
  // hanya menunda kegagalan yang sama dan menggandakan bebannya.
  it('tidak mencoba ulang untuk error selain P2002', async () => {
    mockPrisma.channelIdentity.upsert.mockRejectedValue(new Error('koneksi putus'))

    await expect(
      upsertChannelIdentity({ platform: 'WHATSAPP', externalId: '628', contactId: 'c_y' }),
    ).rejects.toThrow('koneksi putus')
    expect(mockPrisma.channelIdentity.upsert).toHaveBeenCalledTimes(1)
  })
})
