import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { relinkCoexist } from '@/lib/coexist/client'

export async function POST() {
  const waNumber = await prisma.waNumber.findFirstOrThrow()
  await relinkCoexist(waNumber)
  return NextResponse.json({ ok: true })
}
