// Shared shapes for carousel templates, used across submission (src/lib/meta/templates.ts),
// sending (src/lib/meta/messages.ts, src/app/api/send/template), storage (Template.cards,
// Message.templatePayload), and rendering (MessageBubble's CarouselContent).

export type CarouselButtonDef =
  | { type: 'QUICK_REPLY'; text: string }
  | { type: 'URL'; text: string; url: string }
  | { type: 'PHONE_NUMBER'; text: string; phoneNumber: string }

// What an admin authors per card. `mediaUrl` is a plain public HTTPS source, not a Meta
// asset -- it gets re-uploaded to Meta fresh on every single send (see
// uploadMetaMediaFromUrl), because Meta's own handles/ids from submission time expire.
export type CarouselCardDef = {
  mediaType: 'IMAGE' | 'VIDEO'
  mediaUrl: string
  bodyText: string
  buttons: CarouselButtonDef[]
}

// The exact structure of a template message as it was actually sent, snapshotted onto
// Message.templatePayload so the bubble renders it identically forever, independent of
// whatever the source Template row looks like later (edited, deleted, cards changed).
export type SentTemplatePayload = {
  templateName: string
  bodyText: string
  cards?: CarouselCardDef[]
  // LTO: the countdown banner's fixed text plus the real per-send expiration that was
  // actually used -- both needed to render the banner as it looked at send time.
  limitedTimeOffer?: { text: string; expirationTimeMs: number }
  // COUPON: the button's fixed label plus the real, live code this specific send used.
  coupon?: { buttonText: string; code: string }
}
