import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export async function GET() {
  const waNumber = await prisma.waNumber.findFirstOrThrow()
  // Unofficial is send-only (see src/lib/coexist/client.ts) -- there's no
  // live connectivity probe against the target service anymore, just an
  // honest "is this channel configured at all" read of our own DB.
  const unofficialConfigured = Boolean(
    waNumber.coexistBaseUrl && waNumber.coexistApiKey && waNumber.coexistNumberKey
  )
  return NextResponse.json({ officialTokenValid: Boolean(waNumber.accessToken), unofficialConfigured })
}
