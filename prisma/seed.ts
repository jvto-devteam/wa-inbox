import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import bcrypt from 'bcryptjs'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

async function main() {
  const passwordHash = await bcrypt.hash('Admin1234', 12)
  await prisma.account.upsert({
    where: { email: 'admin@jvto.com' },
    update: {},
    create: { email: 'admin@jvto.com', passwordHash, name: 'Admin', role: 'ADMIN' },
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
