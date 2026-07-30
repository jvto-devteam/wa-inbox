import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/require-admin'
import { parseJsonBody } from '@/lib/parse-json'
import { getBusinessProfile, updateBusinessProfile, getBusinessAccountDetails, BUSINESS_VERTICALS } from '@/lib/meta/business-account'

// Admin-only both ways: this is the same WhatsApp Business identity every customer sees, not
// per-agent configuration, and the review/verification status is company-sensitive.
export async function GET(req: Request) {
  const admin = await requireAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Hanya admin yang bisa melihat profil bisnis' }, { status: 403 })

  const waNumber = await prisma.waNumber.findFirstOrThrow()
  try {
    const [profile, account] = await Promise.all([getBusinessProfile(waNumber), getBusinessAccountDetails(waNumber)])
    return NextResponse.json({ profile, account })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Gagal memuat profil bisnis dari Meta'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}

const patchSchema = z.object({
  about: z.string().max(139).optional(),
  address: z.string().max(256).optional(),
  description: z.string().max(256).optional(),
  email: z.string().max(128).optional(),
  vertical: z.enum(BUSINESS_VERTICALS).optional(),
  websites: z.array(z.string()).max(2).optional(),
})

export async function PATCH(req: Request) {
  const admin = await requireAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Hanya admin yang bisa mengubah profil bisnis' }, { status: 403 })

  const parsed = await parseJsonBody(req, patchSchema, 'Data profil bisnis tidak valid')
  if (!parsed.success) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const waNumber = await prisma.waNumber.findFirstOrThrow()
  try {
    await updateBusinessProfile(waNumber, parsed.data)
    const profile = await getBusinessProfile(waNumber)
    return NextResponse.json({ profile })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Gagal menyimpan profil bisnis ke Meta'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
