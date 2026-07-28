import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { submitMetaTemplate, submitCarouselTemplate, submitLtoTemplate, submitCouponTemplate } from '@/lib/meta/templates'
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
  format: z.enum(['TEXT', 'CAROUSEL', 'LTO', 'COUPON']).optional(),
  cards: z.array(cardSchema).min(1).max(10).optional(),
  // LTO fields. Meta caps the countdown banner's text at 16 characters.
  offerTitle: z.string().min(1).max(16).optional(),
  buttons: z.array(buttonSchema).max(3).default([]).optional(),
  // COUPON fields. `couponExampleCode` is only ever the submission-time placeholder Meta
  // needs to approve the template -- the real code is supplied per-send instead.
  couponButtonText: z.string().min(1).optional(),
  couponExampleCode: z.string().min(1).optional(),
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
  // None of LTO/COUPON/CAROUSEL are ever sent as a QUICK_REPLY (those never go to Meta at
  // all, and are dispatched by pasting plain text) -- so any of these combined with
  // QUICK_REPLY can only be a client bug, not a legitimate request.
  if (format !== 'TEXT' && parsed.data.type !== 'OFFICIAL') {
    return NextResponse.json({ error: 'Format ini harus bertipe OFFICIAL' }, { status: 400 })
  }
  if (format === 'CAROUSEL' && (!parsed.data.cards || parsed.data.cards.length === 0)) {
    return NextResponse.json({ error: 'Template carousel butuh minimal 1 kartu' }, { status: 400 })
  }
  if (format === 'LTO' && !parsed.data.offerTitle) {
    return NextResponse.json({ error: 'Template LTO butuh judul penawaran' }, { status: 400 })
  }
  if (format === 'COUPON' && (!parsed.data.couponButtonText || !parsed.data.couponExampleCode)) {
    return NextResponse.json({ error: 'Template kupon butuh label tombol dan contoh kode' }, { status: 400 })
  }

  // MARKETING is not just a default for LTO -- Meta requires it for LIMITED_TIME_OFFER
  // components, so it overrides any category the caller supplied rather than merely falling
  // back to it. Persisted below too, so Template.category reflects what was actually sent
  // to Meta, not whatever the client happened to pass.
  const resolvedCategory =
    format === 'LTO' ? 'MARKETING' : (parsed.data.category ?? (format === 'CAROUSEL' ? 'MARKETING' : 'UTILITY'))

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
          category: resolvedCategory,
          body: parsed.data.body,
          cards: parsed.data.cards!,
        })
      } else if (format === 'LTO') {
        result = await submitLtoTemplate(waNumber, {
          name: parsed.data.name,
          category: resolvedCategory,
          body: parsed.data.body,
          offerTitle: parsed.data.offerTitle!,
          buttons: parsed.data.buttons ?? [],
        })
      } else if (format === 'COUPON') {
        result = await submitCouponTemplate(waNumber, {
          name: parsed.data.name,
          category: resolvedCategory,
          body: parsed.data.body,
          buttonText: parsed.data.couponButtonText!,
          exampleCode: parsed.data.couponExampleCode!,
        })
      } else {
        result = await submitMetaTemplate(waNumber, {
          name: parsed.data.name,
          category: resolvedCategory,
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
      category: parsed.data.type === 'OFFICIAL' ? resolvedCategory : parsed.data.category,
      body: parsed.data.body,
      variables: parsed.data.variables ?? [],
      cards: parsed.data.cards ?? undefined,
      offerTitle: parsed.data.offerTitle,
      buttons: format === 'LTO' ? (parsed.data.buttons ?? []) : undefined,
      couponButtonText: parsed.data.couponButtonText,
      couponExampleCode: parsed.data.couponExampleCode,
      metaId,
      metaStatus,
    },
  })
  return NextResponse.json(template)
}
