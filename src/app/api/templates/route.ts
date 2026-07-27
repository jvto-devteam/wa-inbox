import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { submitMetaTemplate, submitCarouselTemplate } from '@/lib/meta/templates'
import { requireAdmin } from '@/lib/auth/require-admin'
import { parseJsonBody } from '@/lib/parse-json'

// Reading templates stays open — agents pick quick replies from this list in
// the compose box.
export async function GET() {
  return NextResponse.json(await prisma.template.findMany())
}

const buttonSchema = z.union([
  z.object({ type: z.literal('QUICK_REPLY'), text: z.string().min(1) }),
  z.object({ type: z.literal('URL'), text: z.string().min(1), url: z.string().url() }),
  z.object({ type: z.literal('PHONE_NUMBER'), text: z.string().min(1), phoneNumber: z.string().min(1) }),
])

// Meta caps a carousel card at 2 buttons and a carousel at 10 cards.
const cardSchema = z.object({
  mediaType: z.enum(['IMAGE', 'VIDEO']),
  mediaUrl: z.string().url(),
  bodyText: z.string().min(1),
  buttons: z.array(buttonSchema).max(2).default([]),
})

const bodySchema = z.object({
  name: z.string().min(1),
  type: z.enum(['OFFICIAL', 'QUICK_REPLY']),
  category: z.string().optional(),
  body: z.string().min(1),
  variables: z.array(z.string()).optional(),
  format: z.enum(['TEXT', 'CAROUSEL']).optional(),
  cards: z.array(cardSchema).min(1).max(10).optional(),
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

  const format = parsed.data.format ?? 'TEXT'
  // A carousel is never sent as a QUICK_REPLY (those never go to Meta at all, and are
  // dispatched by pasting plain text) -- so a CAROUSEL/QUICK_REPLY combination can only be a
  // client bug, not a legitimate request.
  if (format === 'CAROUSEL' && parsed.data.type !== 'OFFICIAL') {
    return NextResponse.json({ error: 'Template carousel harus bertipe OFFICIAL' }, { status: 400 })
  }
  if (format === 'CAROUSEL' && (!parsed.data.cards || parsed.data.cards.length === 0)) {
    return NextResponse.json({ error: 'Template carousel butuh minimal 1 kartu' }, { status: 400 })
  }

  let metaStatus: 'PENDING' | 'NOT_APPLICABLE' = 'NOT_APPLICABLE'
  // Meta's own id for the submitted template. It must be persisted: Meta reviews
  // templates asynchronously and only reports the outcome later, via the
  // message_template_status_update webhook keyed by this id (see
  // applyTemplateStatusUpdate in src/lib/inbound.ts). Throwing it away here left
  // metaStatus permanently stuck at whatever the submission response said.
  let metaId: string | null = null
  if (parsed.data.type === 'OFFICIAL') {
    const waNumber = await prisma.waNumber.findFirstOrThrow()
    let result: { metaId: string; status: string }
    try {
      if (format === 'CAROUSEL') {
        // Submitting (not sending) a carousel requires the Resumable Upload API, which is
        // scoped to a Meta App rather than a WABA/phone number -- there is no DB row for it
        // today, only this env var. See src/lib/meta/media-upload.ts's uploadMetaResumable.
        const appId = process.env.META_APP_ID
        if (!appId) {
          return NextResponse.json({ error: 'META_APP_ID belum dikonfigurasi di server' }, { status: 500 })
        }
        result = await submitCarouselTemplate(waNumber, appId, {
          name: parsed.data.name,
          category: parsed.data.category ?? 'MARKETING',
          body: parsed.data.body,
          cards: parsed.data.cards!,
        })
      } else {
        result = await submitMetaTemplate(waNumber, {
          name: parsed.data.name,
          category: parsed.data.category ?? 'UTILITY',
          body: parsed.data.body,
          variables: parsed.data.variables ?? [],
        })
      }
    } catch (err) {
      // Submission to Meta failed — do not create a local row with a
      // fabricated/stale status. Surface the failure to the caller.
      const message = err instanceof Error ? err.message : 'Gagal mengirim template ke Meta'
      return NextResponse.json({ error: message }, { status: 502 })
    }
    metaStatus = result.status as 'PENDING'
    metaId = result.metaId
  }

  const template = await prisma.template.create({
    data: {
      name: parsed.data.name,
      type: parsed.data.type,
      format,
      category: parsed.data.category,
      body: parsed.data.body,
      variables: parsed.data.variables ?? [],
      cards: parsed.data.cards ?? undefined,
      metaId,
      metaStatus,
    },
  })
  return NextResponse.json(template)
}
