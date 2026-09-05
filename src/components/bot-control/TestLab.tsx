'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { fetchJson } from '@/lib/fetch-json'

type ContextChoice = 'none' | 'conversation' | 'test-room'

export type SimulationResult = {
  mode: string
  reply: string | null
  status: string
  flowSteps: Array<{ label: string; detail: string }>
  knowledgeRefs: { sourceTopic?: string } | null
  verification: Record<string, unknown> | null
  warnings: string[]
  wouldSendViaChannel: string
  decisionRunId: string | null
  latencyMs: number
}

type ConversationOption = { id: string; contactName: string | null }

const STATUS_VARIANT: Record<string, 'success' | 'warning' | 'destructive'> = {
  WOULD_REPLY: 'success',
  WOULD_CLARIFY: 'warning',
  WOULD_HANDOFF: 'destructive',
  FAILED: 'destructive',
}

export function TestLab({ conversations = [] }: { conversations?: ConversationOption[] }) {
  const [message, setMessage] = useState('')
  const [context, setContext] = useState<ContextChoice>('none')
  const [conversationId, setConversationId] = useState('')
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<SimulationResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    if (running || !message.trim()) return
    setRunning(true)
    setError(null)
    setResult(null)
    try {
      const body: Record<string, unknown> = { message: message.trim(), dryRun: true }
      if (context === 'conversation' && conversationId) {
        body.conversationId = conversationId
        body.useExistingHistory = true
      } else if (context === 'test-room' && conversationId) {
        body.conversationId = conversationId
        body.useExistingHistory = false
      }
      setResult(
        await fetchJson<SimulationResult>('/api/bot-control/simulate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      )
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Simulasi gagal')
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-4">
        <label className="block space-y-1">
          <span className="text-sm font-medium text-navy">Pesan pelanggan</span>
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={3}
            placeholder="berapa harga ijen 3d2n dari bali?"
            aria-label="Pesan pelanggan"
          />
        </label>

        <div className="flex flex-wrap items-end gap-2">
          <label className="space-y-1">
            <span className="block text-xs font-medium uppercase tracking-wide text-muted-foreground">Konteks</span>
            <Select
              value={context}
              onChange={(e) => setContext(e.target.value as ContextChoice)}
              className="w-auto"
              aria-label="Pilih konteks"
            >
              <option value="none">Tanpa history</option>
              <option value="conversation">Pakai percakapan existing</option>
              <option value="test-room">Pakai test room</option>
            </Select>
          </label>

          {context === 'conversation' && (
            <label className="space-y-1">
              <span className="block text-xs font-medium uppercase tracking-wide text-muted-foreground">Percakapan</span>
              <Select
                value={conversationId}
                onChange={(e) => setConversationId(e.target.value)}
                className="w-64"
                aria-label="Pilih percakapan"
              >
                <option value="">Pilih percakapan...</option>
                {conversations.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.contactName ?? c.id}
                  </option>
                ))}
              </Select>
            </label>
          )}

          <Button onClick={run} disabled={running || !message.trim()}>
            {running ? 'Menjalankan...' : 'Jalankan Simulasi'}
          </Button>
        </div>
      </Card>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {result && (
        <Card className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={STATUS_VARIANT[result.status] ?? 'default'}>{result.status}</Badge>
            <span className="font-mono text-xs uppercase text-brand">{result.mode}</span>
            <span className="text-xs text-muted-foreground">{result.latencyMs} ms</span>
            {/* Which channel this WOULD have gone out on -- the answer to guidebook §27's
                "jalur pengiriman mana yang dipakai", without anything being sent. */}
            <Badge variant="muted">Akan dikirim via {result.wouldSendViaChannel}</Badge>
          </div>

          <div className="space-y-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Draft balasan</p>
            {result.reply ? (
              <p className="whitespace-pre-wrap text-sm text-foreground">{result.reply}</p>
            ) : (
              <p className="text-sm text-muted-foreground">
                Tidak ada draft balasan — bot akan menyerahkan percakapan ini ke agen.
              </p>
            )}
          </div>

          {result.warnings.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Peringatan</p>
              <ul className="list-disc space-y-0.5 pl-4 text-xs text-amber-700">
                {result.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          )}

          {result.flowSteps.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Langkah flow</p>
              <ol className="space-y-1.5">
                {result.flowSteps.map((step, i) => (
                  <li key={`${step.label}-${i}`} className="flex gap-1.5 text-xs">
                    <span className="shrink-0 font-mono text-muted-foreground">{i + 1}.</span>
                    <div>
                      <p className="font-medium text-navy">{step.label}</p>
                      <p className="text-muted-foreground">{step.detail}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          )}

          <div className="space-y-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Knowledge yang dipakai</p>
            {result.knowledgeRefs?.sourceTopic ? (
              <p className="text-sm text-foreground">{result.knowledgeRefs.sourceTopic}</p>
            ) : (
              <p className="text-sm text-muted-foreground">Tidak ada topik knowledge yang dilaporkan.</p>
            )}
          </div>

          <div className="space-y-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Verifikasi</p>
            {result.verification ? (
              <pre className="overflow-x-auto rounded bg-muted p-2 text-xs">
                {JSON.stringify(result.verification, null, 2)}
              </pre>
            ) : (
              <p className="text-sm text-muted-foreground">
                Decision engine tidak melaporkan hasil verifikasi terpisah untuk putaran ini.
              </p>
            )}
          </div>

          {result.decisionRunId && (
            <Link href={`/bot-control/decisions?run=${result.decisionRunId}`} className="block text-xs text-brand hover:underline">
              Lihat di Decision Logs →
            </Link>
          )}
        </Card>
      )}
    </div>
  )
}

/** Loads the conversation picker options. Kept out of TestLab so the component stays testable. */
export function useConversationOptions(): ConversationOption[] {
  const [options, setOptions] = useState<ConversationOption[]>([])
  useEffect(() => {
    // /api/conversations returns a flat `contactName`, not a nested contact object, and the
    // sandbox test room is filtered out: simulating "against" the sandbox from the existing-
    // conversation picker would be a confusing no-op, since every run already happens there.
    fetchJson<Array<{ id: string; contactName: string | null; isTest?: boolean }>>('/api/conversations')
      .then((rows) =>
        setOptions(rows.filter((row) => !row.isTest).map((row) => ({ id: row.id, contactName: row.contactName })))
      )
      .catch(() => {})
  }, [])
  return options
}
