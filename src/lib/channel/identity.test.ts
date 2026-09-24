import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
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

    const arg = mockPrisma.channelIdentity.upsert.mock.calls[0][0]
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
})
