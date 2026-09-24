/**
 * Bentuk payload webhook Messenger dan Instagram DM.
 *
 * Berbeda dari WhatsApp: WhatsApp membungkus pesan di `entry[].changes[].value.messages[]`,
 * Messenger dan Instagram DM memakai `entry[].messaging[]` tanpa lapisan `changes` sama sekali.
 * Loop WhatsApp yang ada di src/lib/inbound.ts tidak akan pernah melihat pesan ini -- ia
 * membaca `entry.changes` yang di payload ini tidak ada, jadi pesannya lolos verifikasi
 * signature lalu dibuang diam-diam sambil endpoint tetap membalas 200.
 */
export interface MessengerMessagingEvent {
  sender: { id: string }
  recipient: { id: string }
  timestamp: number
  message?: {
    mid: string
    text?: string
    is_echo?: boolean
    attachments?: Array<{ type: string; payload?: { url?: string } }>
  }
}

export interface MessengerWebhookEntry {
  id: string
  time: number
  messaging?: MessengerMessagingEvent[]
}

export interface MessengerWebhookPayload {
  object: 'page' | 'instagram'
  entry?: MessengerWebhookEntry[]
}

export function isMessengerPayload(payload: unknown): payload is MessengerWebhookPayload {
  if (typeof payload !== 'object' || payload === null) return false
  const object = (payload as { object?: unknown }).object
  return object === 'page' || object === 'instagram'
}
