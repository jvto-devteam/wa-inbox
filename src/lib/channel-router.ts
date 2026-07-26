import { prisma } from '@/lib/db'

export async function resolveChannel(explicit?: 'OFFICIAL' | 'UNOFFICIAL'): Promise<'OFFICIAL' | 'UNOFFICIAL'> {
  if (explicit) return explicit
  const settings = await prisma.settings.findUniqueOrThrow({ where: { id: 1 } })
  return settings.defaultChannel
}
