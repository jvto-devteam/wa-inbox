type RealtimeEvent =
  | { type: 'message.created'; conversationId: string; message: unknown }
  | { type: 'handoff.alert'; conversationId: string; contactName: string | null }

const listeners = new Set<(event: RealtimeEvent) => void>()

export function broadcast(event: RealtimeEvent): void {
  for (const listener of listeners) listener(event)
}

export function subscribe(listener: (event: RealtimeEvent) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
