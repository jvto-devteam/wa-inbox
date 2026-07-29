import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth/get-session'
import { parseJsonBody } from '@/lib/parse-json'
import { sendTemplateMessage } from '@/lib/meta/messages'
import { uploadMetaMediaFromUrl } from '@/lib/meta/media-upload'
import { broadcast } from '@/lib/realtime'
import { withMediaUrl } from '@/lib/serialize-message'
import type { CarouselCardDef, SentTemplatePayload, TemplateHeaderDef } from '@/lib/meta/carousel-types'

const bodySchema = z.object({
  conversationId: z.string(),
  templateId: z.string(),
  bodyParams: z.array(z.string()).optional(),
  // LTO: the real expiration for this specific send, in epoch milliseconds -- required
  // whenever the template's format is LTO (Meta needs a fresh timestamp every send; the
  // submission-time row only ever recorded `has_expiration: true`, never a real value).
  expirationTimeMs: z.number().optional(),
  // COUPON: the real, live code this customer receives -- required whenever the template's
  // format is COUPON (never the submission-time placeholder `couponExampleCode`).
  couponCode: z.string().optional(),
})

function interpolateBody(body: string, params: string[]): string {
  return params.reduce((acc, value, i) => acc.split(`{{${i + 1}}}`).join(value), body)
}

/**
 * The real Cloud API template send path (type: 'template'), as opposed to ComposeBox's
 * quick-reply shortcut which just pastes a QUICK_REPLY template's text into a plain-text
 * send. Templates only ever go out over the Official channel -- Meta template messages are
 * a Cloud API concept with no wa-coexist equivalent.
 */
export async function POST(req: Request) {
  const parsed = await parseJsonBody(req, bodySchema, 'conversationId dan templateId wajib diisi')
  if (!parsed.success) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const template = await prisma.template.findUnique({ where: { id: parsed.data.templateId } })
  if (!template) return NextResponse.json({ error: 'Template tidak ditemukan' }, { status: 404 })
  if (template.metaStatus !== 'APPROVED') {
    return NextResponse.json({ error: 'Template belum disetujui Meta' }, { status: 400 })
  }
  if (template.format === 'LTO' && parsed.data.expirationTimeMs == null) {
    return NextResponse.json({ error: 'Template LTO butuh waktu kadaluarsa' }, { status: 400 })
  }
  if (template.format === 'COUPON' && !parsed.data.couponCode) {
    return NextResponse.json({ error: 'Template kupon butuh kode yang akan dikirim' }, { status: 400 })
  }

  const conversation = await prisma.conversation.findUniqueOrThrow({
    where: { id: parsed.data.conversationId },
    include: { contact: true },
  })
  const waNumber = await prisma.waNumber.findFirstOrThrow()
  const session = await getSession(req)

  const bodyParams = parsed.data.bodyParams ?? []
  const cardDefs = (template.cards as CarouselCardDef[] | null) ?? []
  const headerDef = template.header as TemplateHeaderDef | null

  // Every card's source media is re-uploaded fresh on every send: Meta's ids/handles from
  // template-submission time are short-lived and cannot be reused (see media-upload.ts).
  let sendCards: Array<{ mediaId: string; mediaType: 'IMAGE' | 'VIDEO'; buttons: CarouselCardDef['buttons'] }> = []
  // Same reasoning for a TEXT/AUTH template's own media header (a plain TEXT header is
  // static and needs nothing here).
  let sendHeader: { mediaId: string; mediaType: 'IMAGE' | 'VIDEO' | 'DOCUMENT' } | undefined
  try {
    if (cardDefs.length > 0) {
      const uploaded = await Promise.all(
        cardDefs.map(async (card) => ({ card, media: await uploadMetaMediaFromUrl(waNumber, card.mediaUrl) }))
      )
      sendCards = uploaded.map(({ card, media }) => ({ mediaId: media.id, mediaType: card.mediaType, buttons: card.buttons }))
    }
    if (headerDef && headerDef.type !== 'NONE' && headerDef.type !== 'TEXT') {
      const media = await uploadMetaMediaFromUrl(waNumber, headerDef.mediaUrl)
      sendHeader = { mediaId: media.id, mediaType: headerDef.type }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Gagal menyiapkan media template'
    return NextResponse.json({ error: message }, { status: 502 })
  }

  const resolvedBody = interpolateBody(template.body, bodyParams)
  let externalId: string | undefined
  let deliveryStatus: 'SENT' | 'FAILED' = 'SENT'
  try {
    const result = await sendTemplateMessage(waNumber, conversation.contact.phone, {
      name: template.name,
      bodyParams,
      header: sendHeader,
      cards: sendCards,
      limitedTimeOfferExpirationMs: parsed.data.expirationTimeMs,
      couponCode: parsed.data.couponCode,
    })
    externalId = result.externalId
  } catch (error) {
    console.error('send/template: dispatch failed', { conversationId: parsed.data.conversationId, error })
    deliveryStatus = 'FAILED'
  }

  const templatePayload: SentTemplatePayload = {
    templateName: template.name,
    bodyText: resolvedBody,
    cards: cardDefs.length > 0 ? cardDefs : undefined,
    limitedTimeOffer:
      template.format === 'LTO' && template.offerTitle && parsed.data.expirationTimeMs != null
        ? { text: template.offerTitle, expirationTimeMs: parsed.data.expirationTimeMs }
        : undefined,
    coupon:
      template.format === 'COUPON' && template.couponButtonText && parsed.data.couponCode
        ? { buttonText: template.couponButtonText, code: parsed.data.couponCode }
        : undefined,
  }

  const created = await prisma.message.create({
    data: {
      conversationId: parsed.data.conversationId,
      externalId,
      direction: 'OUTBOUND',
      type: 'template',
      content: resolvedBody,
      channel: 'OFFICIAL',
      sentBy: 'AGENT',
      agentId: session?.accountId,
      deliveryStatus,
      templatePayload: templatePayload as never,
    },
    include: { replyTo: true },
  })
  broadcast({ type: 'message.created', conversationId: parsed.data.conversationId, message: withMediaUrl(created) })
  return NextResponse.json(created)
}
