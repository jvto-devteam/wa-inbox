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
  await prisma.settings.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1 },
  })
}

main().finally(() => prisma.$disconnect())
