import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { ensureTestConversation, TEST_CONTACT_PHONE } from './test-conversation'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

beforeEach(() => {
  mockReset(mockPrisma)
})

describe('ensureTestConversation', () => {
  it('creates the sandbox contact by the reserved sentinel identity when unknown, then the pinned/test conversation by channel identity', async () => {
    mockPrisma.channelIdentity.findUnique.mockResolvedValue(null)
    mockPrisma.contact.create.mockResolvedValue({ id: 'contact_test', phone: TEST_CONTACT_PHONE } as never)
    mockPrisma.channelIdentity.upsert.mockResolvedValue({ id: 'identity_test', contactId: 'contact_test' } as never)
    mockPrisma.conversation.upsert.mockResolvedValue({} as never)

    await ensureTestConversation()

    expect(mockPrisma.channelIdentity.findUnique).toHaveBeenCalledWith({
      where: { platform_externalId: { platform: 'WHATSAPP', externalId: TEST_CONTACT_PHONE } },
      select: { contactId: true },
    })
    expect(mockPrisma.contact.create).toHaveBeenCalledWith({
      data: { phone: TEST_CONTACT_PHONE, name: '🧪 Tes Bot (Internal)' },
    })
    expect(mockPrisma.channelIdentity.upsert).toHaveBeenCalledWith({
      where: { platform_externalId: { platform: 'WHATSAPP', externalId: TEST_CONTACT_PHONE } },
      update: {},
      create: { platform: 'WHATSAPP', externalId: TEST_CONTACT_PHONE, contactId: 'contact_test', displayName: null },
      select: { id: true, contactId: true },
    })
    expect(mockPrisma.conversation.upsert).toHaveBeenCalledWith({
      where: {
        channelIdentityId_externalThreadId: { channelIdentityId: 'identity_test', externalThreadId: '' },
      },
      update: {},
      create: {
        contactId: 'contact_test',
        channelIdentityId: 'identity_test',
        externalThreadId: '',
        isPinned: true,
        isTest: true,
      },
    })
  })

  it('reuses an existing channel identity instead of creating a new contact', async () => {
    mockPrisma.channelIdentity.findUnique.mockResolvedValue({ contactId: 'contact_existing' } as never)
    mockPrisma.channelIdentity.upsert.mockResolvedValue({ id: 'identity_existing', contactId: 'contact_existing' } as never)
    mockPrisma.conversation.upsert.mockResolvedValue({} as never)

    await ensureTestConversation()

    expect(mockPrisma.contact.create).not.toHaveBeenCalled()
    expect(mockPrisma.conversation.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ contactId: 'contact_existing', channelIdentityId: 'identity_existing' }),
      })
    )
  })
})
