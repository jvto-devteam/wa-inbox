import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateApiClient } from '@/lib/api-clients/auth'
import { parseJsonBody } from '@/lib/parse-json'
import { enqueueSystemTemplateSend } from '@/lib/system-templates/send'

/**
 * POST /api/v1/system-messages — how javavolcano-touroperator and new-backoffice send WhatsApp.
 *
 *   Authorization: Bearer wai_...
 *   { "templateKey": "payment_received_first",
 *     "to": { "phone": "6281234567890" } | { "groupId": "120363...@g.us" },
 *     "variables": { "name": "Anna", ... },
 *     "idempotencyKey": "payment_received_first:1234" }
 *
 * 202 = queued now; 200 + `duplicate: true` = that idempotencyKey was already queued, nothing
 * new was sent. Either way the caller is done. It must retry only on a 5xx or a network error.
 *
 * Machine-to-machine: no session. src/middleware.ts lets this exact path through only when a
 * Bearer key is present, and the key is actually checked here.
 */
const bodySchema = z.object({
  templateKey: z.string().trim().min(1).max(100),
  to: z.union([
    z.object({ phone: z.string().trim().min(1).max(40) }).strict(),
    z.object({ groupId: z.string().trim().regex(/^[\d-]+@g\.us$/) }).strict(),
  ]),
  variables: z.record(z.string(), z.union([z.string().max(4000), z.number(), z.null()])).default({}),
  idempotencyKey: z.string().trim().min(1).max(200),
})

const INVALID_BODY =
  'Format permintaan tidak valid: butuh templateKey, to ({phone} atau {groupId} berakhiran @g.us), variables, dan idempotencyKey.'

export async function POST(req: Request) {
  try {
    const client = await authenticateApiClient(req)
    if (!client) return NextResponse.json({ error: 'API key tidak valid' }, { status: 401 })

    const parsed = await parseJsonBody(req, bodySchema, INVALID_BODY)
    if (!parsed.success) return NextResponse.json({ error: parsed.error }, { status: 400 })

    const result = await enqueueSystemTemplateSend({ clientId: client.id, ...parsed.data })

    if (result.ok) {
      return NextResponse.json(
        { jobId: result.jobId, status: result.status, duplicate: result.duplicate },
        { status: result.duplicate ? 200 : 202 }
      )
    }

    switch (result.code) {
      case 'TEMPLATE_NOT_FOUND':
        return NextResponse.json(
          { error: `Template "${parsed.data.templateKey}" tidak ada atau sedang dinonaktifkan` },
          { status: 404 }
        )
      case 'MISSING_VARIABLES':
        return NextResponse.json({ error: `Variabel wajib kosong: ${result.missing.join(', ')}` }, { status: 400 })
      case 'INVALID_PHONE':
        return NextResponse.json({ error: 'Nomor tujuan tidak valid' }, { status: 400 })
      case 'ENQUEUE_FAILED':
        return NextResponse.json({ error: 'Gagal memasukkan pesan ke antrean, coba lagi' }, { status: 503 })
    }
  } catch (error) {
    console.error('POST /api/v1/system-messages gagal', error)
    return NextResponse.json({ error: 'Gagal memproses permintaan' }, { status: 500 })
  }
}
