import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { submitMetaTemplate } from '@/lib/meta/templates'
import { requireAdmin } from '@/lib/auth/require-admin'
import { parseJsonBody } from '@/lib/parse-json'

// Reading templates stays open — agents pick quick replies from this list in
// the compose box.
export async function GET() {
  return NextResponse.json(await prisma.template.findMany())
}

const bodySchema = z.object({
  name: z.string().min(1),
  type: z.enum(['OFFICIAL', 'QUICK_REPLY']),
  category: z.string().optional(),
  body: z.string().min(1),
  variables: z.array(z.string()).optional(),
})

// Creating a template is admin-only: an OFFICIAL one is submitted straight to
// Meta under the company's WABA, and rejected submissions count against the
// account's quality rating. That is a company-level consequence an individual
// agent shouldn't be able to trigger.
export async function POST(req: Request) {
  const admin = await requireAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Hanya admin yang bisa membuat template' }, { status: 403 })

  const parsed = await parseJsonBody(req, bodySchema, 'Data template tidak valid')
  if (!parsed.success) return NextResponse.json({ error: parsed.error }, { status: 400 })

  let metaStatus: 'PENDING' | 'NOT_APPLICABLE' = 'NOT_APPLICABLE'
  if (parsed.data.type === 'OFFICIAL') {
    const waNumber = await prisma.waNumber.findFirstOrThrow()
    let result: { metaId: string; status: string }
    try {
      result = await submitMetaTemplate(waNumber, {
        name: parsed.data.name,
        category: parsed.data.category ?? 'UTILITY',
        body: parsed.data.body,
        variables: parsed.data.variables ?? [],
      })
    } catch (err) {
      // Submission to Meta failed — do not create a local row with a
      // fabricated/stale status. Surface the failure to the caller.
      const message = err instanceof Error ? err.message : 'Gagal mengirim template ke Meta'
      return NextResponse.json({ error: message }, { status: 502 })
    }
    metaStatus = result.status as 'PENDING'
  }

  const template = await prisma.template.create({
    data: { ...parsed.data, variables: parsed.data.variables ?? [], metaStatus },
  })
  return NextResponse.json(template)
}
