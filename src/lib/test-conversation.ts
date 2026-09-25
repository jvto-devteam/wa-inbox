import { prisma } from '@/lib/db'
import { upsertChannelIdentity } from '@/lib/channel/identity'

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
  // Dicari lewat identitas, bukan lewat nomor: Task 9 melepas Contact.phone @unique dan
  // Prisma menolak field non-unik di `where` sebuah upsert. Sentinel-nya tetap sama.
  const known = await prisma.channelIdentity.findUnique({
    where: { platform_externalId: { platform: 'WHATSAPP', externalId: TEST_CONTACT_PHONE } },
    select: { contactId: true },
  })

  // Ternary, bukan `known ?? (await ...)`: bentuk `??` itu lolos verbatim dari brief tapi
  // gagal `tsc --noEmit` di TS repo ini (TS18047, "contact is possibly null") -- narrowing
  // control-flow TypeScript tidak bertahan lewat `await` di sisi kanan `??`. Perilakunya
  // identik; hanya bentuknya yang berbeda supaya lolos type-check.
  const contact = known
    ? known
    : await prisma.contact
        .create({ data: { phone: TEST_CONTACT_PHONE, name: '🧪 Tes Bot (Internal)' } })
        .then((c) => ({ contactId: c.id }))

  const identity = await upsertChannelIdentity({
    platform: 'WHATSAPP',
    externalId: TEST_CONTACT_PHONE,
    contactId: contact.contactId,
  })

  await prisma.conversation.upsert({
    where: {
      channelIdentityId_externalThreadId: { channelIdentityId: identity.id, externalThreadId: '' },
    },
    update: {},
    create: {
      // WAJIB nilai balik upsertChannelIdentity, bukan contact.contactId milik pemanggil --
      // lihat kontraknya di src/lib/channel/identity.ts. Kalau identitasnya sudah ada,
      // cabang update tidak menyentuh contactId, jadi pemiliknya bisa Contact yang lain.
      contactId: identity.contactId,
      channelIdentityId: identity.id,
      externalThreadId: '',
      isPinned: true,
      isTest: true,
    },
  })
}
