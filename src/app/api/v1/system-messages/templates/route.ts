import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { authenticateApiClient } from '@/lib/api-clients/auth'
import { parseVariables } from '@/lib/system-templates/types'

/**
 * GET /api/v1/system-messages/templates — the contract, readable by the calling programs.
 *
 * Lets a developer on the Laravel side see which keys exist and which variables each one
 * expects, without an Inbox login. Same Bearer key as the send endpoint.
 */
export async function GET(req: Request) {
  try {
    const client = await authenticateApiClient(req)
    if (!client) return NextResponse.json({ error: 'API key tidak valid' }, { status: 401 })

    const templates = await prisma.systemTemplate.findMany({ orderBy: { key: 'asc' } })
    return NextResponse.json({
      items: templates.map((template) => ({
        key: template.key,
        name: template.name,
        description: template.description,
        audience: template.audience,
        isActive: template.isActive,
        hasImage: template.imageUrl !== null,
        variables: parseVariables(template.variables).map(({ name, required, description }) => ({
          name,
          required,
          ...(description ? { description } : {}),
        })),
      })),
    })
  } catch (error) {
    console.error('GET /api/v1/system-messages/templates gagal', error)
    return NextResponse.json({ error: 'Gagal memuat daftar template' }, { status: 500 })
  }
}
