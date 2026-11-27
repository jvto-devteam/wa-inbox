/**
 * Klien telepon-service (`POST /call`, `GET /call/:id`), layanan telepon WhatsApp di VPS yang sama (127.0.0.1:3030).
 * Tidak pernah melempar: hasil selalu objek. Token hanya di header, tidak pernah dicatat atau dikembalikan.
 */
import type { EscalationConfig } from './config'

const TIMEOUT_MS = 10_000

export type PlaceCallResult = { ok: true; jobId: string } | { ok: false; status: number | 'error'; rateLimited: boolean }
export type CallOutcome = { finished: boolean; outcome: string | null }

const headers = (cfg: EscalationConfig) => ({ Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' })

export async function placeCall(cfg: EscalationConfig, input: { audio: string; idempotencyKey: string }): Promise<PlaceCallResult> {
  try {
    const res = await fetch(`${cfg.url}/call`, {
      method: 'POST',
      headers: headers(cfg),
      body: JSON.stringify({ phone: cfg.phone, audio: input.audio, idempotencyKey: input.idempotencyKey }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (res.status === 202 || res.status === 200) {
      const body = (await res.json()) as { id?: unknown }
      if (typeof body.id === 'string') return { ok: true, jobId: body.id }
      return { ok: false, status: res.status, rateLimited: false }
    }
    return { ok: false, status: res.status, rateLimited: res.status === 429 }
  } catch {
    return { ok: false, status: 'error', rateLimited: false }
  }
}

export async function getCallOutcome(cfg: EscalationConfig, jobId: string): Promise<CallOutcome | null> {
  try {
    const res = await fetch(`${cfg.url}/call/${encodeURIComponent(jobId)}`, { headers: headers(cfg), signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!res.ok) return null
    const body = (await res.json()) as { status?: unknown; result?: { outcome?: unknown } | null }
    const finished = body.status === 'done' || body.status === 'failed'
    const outcome = typeof body.result?.outcome === 'string' ? body.result.outcome : body.status === 'failed' ? 'failed' : null
    return { finished, outcome }
  } catch {
    return null
  }
}
