import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import bcrypt from 'bcryptjs'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

async function main() {
  // The seed admin's credentials come from the environment, never from a
  // literal in this file. This same seed runs against production at cutover,
  // and a hardcoded admin@jvto.com / Admin1234 would be a live, publicly
  // guessable admin login with nothing forcing a rotation.
  //
  // For local development, set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD in
  // your local .env (see .env.example) — any values you like, they only exist
  // on your machine. Failing loudly here is deliberate: a seed that silently
  // fell back to a default would put that default into production.
  const seedAdminEmail = process.env.SEED_ADMIN_EMAIL
  const seedAdminPassword = process.env.SEED_ADMIN_PASSWORD
  if (!seedAdminEmail || !seedAdminPassword) {
    throw new Error(
      'SEED_ADMIN_EMAIL dan SEED_ADMIN_PASSWORD wajib diisi sebelum menjalankan seed. ' +
        'Set keduanya di .env (lihat .env.example).'
    )
  }

  const passwordHash = await bcrypt.hash(seedAdminPassword, 12)
  await prisma.account.upsert({
    where: { email: seedAdminEmail },
    update: {},
    create: { email: seedAdminEmail, passwordHash, name: 'Admin', role: 'ADMIN' },
  })
  await prisma.waNumber.upsert({
    where: { phoneNumber: '6282244788833' },
    update: {},
    create: {
      phoneNumber: '6282244788833',
      phoneNumberId: process.env.META_PHONE_NUMBER_ID ?? '',
      wabaId: process.env.META_WABA_ID ?? '',
      accessToken: process.env.META_ACCESS_TOKEN ?? '',
      coexistBaseUrl: process.env.COEXIST_BASE_URL ?? '',
      coexistApiKey: process.env.COEXIST_API_KEY ?? '',
      coexistNumberKey: process.env.COEXIST_NUMBER_KEY ?? '',
    },
  })
  await prisma.settings.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1 },
  })
}

main().finally(() => prisma.$disconnect())
