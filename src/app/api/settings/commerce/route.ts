import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/require-admin'
import { parseJsonBody } from '@/lib/parse-json'
import { getCommerceSettings, updateCommerceSettings } from '@/lib/meta/business-account'

// Admin-only: whether the shopping cart/catalog is visible affects every customer at once.
export async function GET(req: Request) {
  const admin = await requireAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Hanya admin yang bisa melihat pengaturan commerce' }, { status: 403 })

  const waNumber = await prisma.waNumber.findFirstOrThrow()
  try {
    return NextResponse.json(await getCommerceSettings(waNumber))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Gagal memuat pengaturan commerce dari Meta'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}

const patchSchema = z.object({
  isCartEnabled: z.boolean().optional(),
  isCatalogVisible: z.boolean().optional(),
})

export async function PATCH(req: Request) {
  const admin = await requireAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Hanya admin yang bisa mengubah pengaturan commerce' }, { status: 403 })

  const parsed = await parseJsonBody(req, patchSchema, 'Data pengaturan commerce tidak valid')
  if (!parsed.success) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const waNumber = await prisma.waNumber.findFirstOrThrow()
  try {
    await updateCommerceSettings(waNumber, parsed.data)
    return NextResponse.json(await getCommerceSettings(waNumber))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Gagal menyimpan pengaturan commerce ke Meta'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
