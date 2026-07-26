import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCoexistStatus } from '@/lib/coexist/client'

export async function GET() {
  const waNumber = await prisma.waNumber.findFirstOrThrow()
  const coexist = await getCoexistStatus(waNumber)
  return NextResponse.json({ officialTokenValid: Boolean(waNumber.accessToken), unofficialConnected: coexist.connected })
}
