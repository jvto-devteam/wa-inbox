type RealtimeEvent =
  | { type: 'message.created'; conversationId: string; message: unknown }
  // An existing message row changed in place -- currently only Meta delivery receipts
  // (sent/delivered/read/failed) arriving on the webhook long after the message was sent.
  // Distinct from message.created so subscribers replace a bubble instead of appending one.
  | { type: 'message.updated'; conversationId: string; message: unknown }
  | { type: 'handoff.alert'; conversationId: string; contactName: string | null }

const listeners = new Set<(event: RealtimeEvent) => void>()

export function broadcast(event: RealtimeEvent): void {
  for (const listener of listeners) listener(event)
}

export function subscribe(listener: (event: RealtimeEvent) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
