import { prisma } from '@/lib/db'

// A sentinel, deliberately non-numeric so it can never collide with a real E.164-ish phone
// string written anywhere else in the app.
export const TEST_CONTACT_PHONE = '__bot_test__'

/**
 * Ensures the one pinned sandbox conversation exists -- an admin talks to it as if they were
 * the customer (see /api/conversations/[id]/test-message) to exercise the bot without ever
 * reaching a real WhatsApp number. Idempotent and cheap (two upserts by unique keys), so
 * calling this on every inbox list fetch is safe and self-healing if the row is ever deleted.
 */
export async function ensureTestConversation(): Promise<void> {
  const contact = await prisma.contact.upsert({
    where: { phone: TEST_CONTACT_PHONE },
    update: {},
    create: { phone: TEST_CONTACT_PHONE, name: '🧪 Tes Bot (Internal)' },
  })
  await prisma.conversation.upsert({
    where: { contactId: contact.id },
    update: {},
    create: { contactId: contact.id, isPinned: true, isTest: true },
  })
}
