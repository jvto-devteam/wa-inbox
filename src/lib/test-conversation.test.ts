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
  it('upserts the sandbox contact by the reserved sentinel phone, then the pinned/test conversation by contactId', async () => {
    mockPrisma.contact.upsert.mockResolvedValue({ id: 'contact_test', phone: TEST_CONTACT_PHONE } as never)
    mockPrisma.conversation.upsert.mockResolvedValue({} as never)

    await ensureTestConversation()

    expect(mockPrisma.contact.upsert).toHaveBeenCalledWith({
      where: { phone: TEST_CONTACT_PHONE },
      update: {},
      create: { phone: TEST_CONTACT_PHONE, name: '🧪 Tes Bot (Internal)' },
    })
    expect(mockPrisma.conversation.upsert).toHaveBeenCalledWith({
      where: { contactId: 'contact_test' },
      update: {},
      create: { contactId: 'contact_test', isPinned: true, isTest: true },
    })
  })
})
