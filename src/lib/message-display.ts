// A bot handoff is recorded (Task 34) as a Message row with `content: null` and
// `sentBy: 'BOT'` — a log-only audit record. Nothing was ever sent to the
// customer; the bot decided to hand the conversation to a human agent.
//
// Three surfaces render messages and all three must say so rather than showing a
// blank bubble, a blank sidebar preview, or (worst) a bogus `[text]` placeholder
// that reads as "the bot sent a text message":
//   - src/components/inbox/MessageBubble.tsx        (thread bubble)
//   - src/components/inbox/ConversationListItem.tsx (sidebar preview)
//   - src/app/(authenticated)/contacts/[id]/page.tsx (CRM message history)
// Each used to carry its own copy of this one-line check; this module is the
// single definition so a fourth surface cannot drift.

export const HANDOFF_LOG_TEXT = 'Bot menyerahkan ke agen — lihat alasan'

export function isHandoffLogMessage(message: {
  sentBy: string | null
  content: string | null
}): boolean {
  return message.sentBy === 'BOT' && message.content === null
}

/**
 * The text to render for a message row.
 *
 * Handoff logs get the explanatory placeholder; a genuinely content-less message
 * of another kind (an image, a sticker) falls back to its `[type]` marker, which
 * is what the CRM history rendered for everything before this helper existed.
 */
export function displayMessageContent(message: {
  sentBy: string | null
  content: string | null
  type?: string | null
}): string {
  if (isHandoffLogMessage(message)) return HANDOFF_LOG_TEXT
  if (message.content !== null) return message.content
  return message.type ? `[${message.type}]` : ''
}
