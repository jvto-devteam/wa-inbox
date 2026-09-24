#!/usr/bin/env node
/**
 * Backfill sekali jalan: tiap Contact yang punya phone mendapat satu ChannelIdentity
 * WHATSAPP, dan tiap Conversation ditautkan ke identitas kontaknya.
 *
 * Idempoten: dijalankan dua kali menghasilkan keadaan yang sama, karena upsert berkunci
 * (platform, externalId) dan update hanya menyentuh baris yang channelIdentityId-nya null.
 *
 * Jalankan dengan:
 *   node --env-file=.env scripts/backfill-channel-identity.mjs
 *
 * `node` polos tidak memuat `.env` sendiri (beda dari Next.js) — tanpa `--env-file=.env`,
 * DATABASE_URL kosong dan adapter gagal dengan pesan yang jauh dari sebabnya.
 */
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

if (!process.env.DATABASE_URL) {
  console.error(
    'GAGAL: DATABASE_URL kosong. Jalankan dengan: node --env-file=.env scripts/backfill-channel-identity.mjs',
  )
  process.exit(1)
}

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

let identitas = 0
let tertaut = 0

const contacts = await prisma.contact.findMany({ select: { id: true, phone: true, name: true } })

for (const c of contacts) {
  if (!c.phone) continue
  const identity = await prisma.channelIdentity.upsert({
    where: { platform_externalId: { platform: 'WHATSAPP', externalId: c.phone } },
    update: {},
    create: { platform: 'WHATSAPP', externalId: c.phone, contactId: c.id, displayName: c.name },
    select: { id: true },
  })
  identitas += 1

  const res = await prisma.conversation.updateMany({
    where: { contactId: c.id, channelIdentityId: null },
    data: { channelIdentityId: identity.id },
  })
  tertaut += res.count
}

const sisa = await prisma.conversation.count({ where: { channelIdentityId: null } })

console.log(`identitas disiapkan : ${identitas}`)
console.log(`conversation tertaut: ${tertaut}`)
console.log(`masih null          : ${sisa}`)

await prisma.$disconnect()

if (sisa > 0) {
  console.error(`\nGAGAL: ${sisa} conversation masih tanpa channelIdentityId.`)
  process.exit(1)
}
console.log('\nOK: setiap conversation punya channelIdentityId.')
