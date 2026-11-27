/** Ringkasan galat webhook Meta untuk log (dipakai POST /api/webhooks/meta): tanpa nilai payload, tanpa nomor/email. */
const keysOf = (v: unknown): string[] => (v && typeof v === 'object' && !Array.isArray(v) ? Object.keys(v).sort() : [])
const listKeys = (v: unknown): string[][] => (Array.isArray(v) ? v.map(keysOf) : [])

/** Ringkasan galat webhook untuk log: jenis galat, kode Prisma, pesan tersamar, dan bentuk payload tanpa nilai. */
export function describeWebhookFailure(payload: unknown, error: unknown) {
  const p = payload as { object?: unknown; entry?: unknown }
  const entries = Array.isArray(p?.entry) ? p.entry : []
  const shape = entries.map((entry) => {
    const changes = (entry as { changes?: unknown })?.changes
    return {
      keys: keysOf(entry),
      changes: (Array.isArray(changes) ? changes : []).map((change) => {
        const c = change as { field?: unknown; value?: Record<string, unknown> }
        return {
          field: typeof c?.field === 'string' ? c.field : null,
          value: keysOf(c?.value),
          messages: listKeys(c?.value?.messages),
          contacts: listKeys(c?.value?.contacts),
          echoes: listKeys(c?.value?.message_echoes),
        }
      }),
    }
  })
  const raw = error instanceof Error ? error.message : String(error)
  return {
    error: error instanceof Error ? error.name : typeof error,
    code: typeof (error as { code?: unknown })?.code === 'string' ? (error as { code: string }).code : undefined,
    message: raw.replace(/[^\s@]+@[^\s@]+/g, '…').replace(/\d{6,}/g, '…').slice(0, 600),
    object: typeof p?.object === 'string' ? p.object : null,
    shape: JSON.stringify(shape).slice(0, 1500),
  }
}
