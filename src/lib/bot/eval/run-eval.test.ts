import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { cleanup } from './run-eval'

// Regression test for a Critical review finding: cleanup() used to be a single
// `prisma.contact.deleteMany(...)`, on the assumption that deleting a Contact cascades to its
// Conversation and Message rows. It does not -- Conversation_contactId_fkey and
// Message_conversationId_fkey are both ON DELETE RESTRICT (prisma/migrations/
// 20260727013701_init/migration.sql:194, :200), and relationMode is unset in schema.prisma
// (real Postgres FKs, not Prisma-emulated ones). So the old cleanup() threw a live FK
// violation on its very first real run -- before printing a single result line, since it ran
// in a `finally` ahead of the print loop -- and left every eval- Contact/Conversation row
// permanently stuck in the database.
//
// This never surfaced in the manual verification pass because verifying it means actually
// running the script, which touches a real database and is explicitly off-limits here (see
// run-eval.ts's header: it needs a live Ollama + DB, and is deliberately kept out of `npm
// test`). What CAN be verified without a database is the shape of the fix: that `cleanup`
// deletes in the correct dependency order and with the correct scoping. That's what this file
// checks, against a fully mocked `@/lib/db` -- no real Postgres, no real FK constraint, no
// Ollama. It cannot prove the real DELETE statements succeed against live FKs; it can only
// prove the code asks for them in an order that WOULD succeed given those FKs. Importing
// `cleanup` from run-eval.ts is safe here because that module's top-level `main()` call is
// guarded by `!process.env.VITEST`, which Vitest sets for this process -- so this import can
// never fire `main()`, hit the real database, or call `process.exit`.
vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

beforeEach(() => {
  mockReset(mockPrisma)
})

describe('cleanup', () => {
  it('deletes Message, then Conversation, then Contact -- the FK dependency order, leaves first', async () => {
    await cleanup()

    const messageOrder = mockPrisma.message.deleteMany.mock.invocationCallOrder[0]
    const conversationOrder = mockPrisma.conversation.deleteMany.mock.invocationCallOrder[0]
    const contactOrder = mockPrisma.contact.deleteMany.mock.invocationCallOrder[0]

    expect(messageOrder).toBeDefined()
    expect(conversationOrder).toBeDefined()
    expect(contactOrder).toBeDefined()
    expect(messageOrder).toBeLessThan(conversationOrder)
    expect(conversationOrder).toBeLessThan(contactOrder)
  })

  it('scopes every delete to the eval- prefix, so it can never reach a real customer row', async () => {
    await cleanup()

    expect(mockPrisma.message.deleteMany).toHaveBeenCalledWith({
      where: { conversation: { contact: { phone: { startsWith: 'eval-' } } } },
    })
    expect(mockPrisma.conversation.deleteMany).toHaveBeenCalledWith({
      where: { contact: { phone: { startsWith: 'eval-' } } },
    })
    expect(mockPrisma.contact.deleteMany).toHaveBeenCalledWith({
      where: { phone: { startsWith: 'eval-' } },
    })
  })

  it('calls each deleteMany exactly once', async () => {
    await cleanup()

    expect(mockPrisma.message.deleteMany).toHaveBeenCalledTimes(1)
    expect(mockPrisma.conversation.deleteMany).toHaveBeenCalledTimes(1)
    expect(mockPrisma.contact.deleteMany).toHaveBeenCalledTimes(1)
  })
})
