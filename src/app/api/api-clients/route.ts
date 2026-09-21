import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/require-admin'
import { parseJsonBody } from '@/lib/parse-json'
import { generateApiKey } from '@/lib/api-clients/auth'

/**
 * API keys for the programs that call /api/v1/system-messages.
 *
 * The raw key appears in exactly one response — the POST that creates it — and is never stored,
 * listed, or logged afterwards (CLAUDE.md §5). The list shows only the prefix.
 */
const PUBLIC_FIELDS = { id: true, name: true, keyPrefix: true, lastUsedAt: true, revokedAt: true, createdAt: true } as const

export async function GET(req: Request) {
  const admin = await requireAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Hanya admin yang bisa melihat API client' }, { status: 403 })

  try {
    const clients = await prisma.apiClient.findMany({ select: PUBLIC_FIELDS, orderBy: { createdAt: 'desc' } })
    return NextResponse.json({ items: clients })
  } catch (error) {
    console.error('GET /api/api-clients gagal', error)
    return NextResponse.json({ error: 'Gagal memuat API client' }, { status: 500 })
  }
}

const createSchema = z.object({ name: z.string().trim().min(1).max(80) }).strict()

export async function POST(req: Request) {
  const admin = await requireAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Hanya admin yang bisa membuat API client' }, { status: 403 })

  const parsed = await parseJsonBody(req, createSchema, 'Nama API client wajib diisi')
  if (!parsed.success) return NextResponse.json({ error: parsed.error }, { status: 400 })

  try {
    const { key, keyHash, keyPrefix } = generateApiKey()
    const client = await prisma.apiClient.create({
      data: { name: parsed.data.name, keyHash, keyPrefix },
      select: PUBLIC_FIELDS,
    })
    // The only time `key` leaves this server.
    return NextResponse.json({ ...client, key }, { status: 201 })
  } catch (error) {
    console.error('POST /api/api-clients gagal', error)
    return NextResponse.json({ error: 'Gagal membuat API client' }, { status: 500 })
  }
}
