'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Field } from '@/components/ui/label'
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
      const simulated = await fetchJson<SimulationResult>('/api/bot-control/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      setResult(simulated)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Simulasi gagal')
    } finally {
      setRunning(false)
    }
  }

  return (
    // Formulir di kiri, hasil di kanan, mulai xl. Sebelumnya keduanya bertumpuk: satu kartu
    // berisi satu textarea dan satu tombol, lalu hasilnya jauh di bawah lipatan — dan pada layar
    // lebar formulir itu terentang selebar halaman tanpa ada yang mengisinya. Formulirnya
    // sengaja dikunci 28rem: kotak teks selebar layar penuh lebih buruk daripada yang sempit.
    <div className="grid gap-4 xl:grid-cols-[minmax(0,28rem)_minmax(0,1fr)] xl:items-start">
      <Card className="space-y-3 p-4">
        <Field label="Pesan pelanggan">
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={3}
            placeholder="berapa harga ijen 3d2n dari bali?"
            aria-label="Pesan pelanggan"
          />
        </Field>

        <div className="flex flex-wrap items-end gap-3">
          <Field label="Konteks">
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
          </Field>

          {context === 'conversation' && (
            <Field label="Percakapan">
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
            </Field>
          )}

          <Button onClick={run} disabled={running || !message.trim()}>
            {running ? 'Menjalankan...' : 'Jalankan Simulasi'}
          </Button>
        </div>
      </Card>

      <div className="min-w-0 space-y-4">
        {error && <p className="text-base text-danger">{error}</p>}

        {/* Kolom kanan tidak dibiarkan menganga saat belum ada yang dijalankan: ia mengatakan
            apa yang akan muncul di sana. */}
        {!result && !error && (
          <div className="rounded-lg border border-dashed border-line px-4 py-6 text-sm text-ink-muted">
            Hasil simulasi muncul di sini: draft balasan, langkah flow yang dilalui, knowledge yang
            dipakai, dan jalur kirim yang akan dipakai seandainya pesan ini benar-benar dibalas.
          </div>
        )}

        {result && (
        <Card>
          <CardHeader className="flex-wrap gap-2">
            <span className="flex flex-wrap items-center gap-2">
              <Badge variant={STATUS_VARIANT[result.status] ?? 'default'}>{result.status}</Badge>
              <span className="font-mono text-xs text-ink-muted uppercase">{result.mode}</span>
              <span className="font-mono text-xs text-ink-muted">{result.latencyMs} ms</span>
            </span>
            {/* Which channel this WOULD have gone out on -- the answer to guidebook §27's
                "jalur pengiriman mana yang dipakai", without anything being sent. */}
            <Badge variant="muted">Akan dikirim via {result.wouldSendViaChannel}</Badge>
          </CardHeader>

          <div className="divide-y divide-line">
            <ResultBlock label="Draft balasan">
              {result.reply ? (
                <p className="text-base whitespace-pre-wrap text-ink">{result.reply}</p>
              ) : (
                <p className="text-base text-ink-muted">
                  Tidak ada draft balasan — bot akan menyerahkan percakapan ini ke agen.
                </p>
              )}
            </ResultBlock>

            {result.warnings.length > 0 && (
              <ResultBlock label="Peringatan">
                <ul className="list-disc space-y-0.5 pl-4 text-sm text-warning">
                  {result.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </ResultBlock>
            )}

            {result.flowSteps.length > 0 && (
              <ResultBlock label="Langkah flow">
                <ol className="space-y-1.5">
                  {result.flowSteps.map((step, i) => (
                    <li key={`${step.label}-${i}`} className="flex gap-1.5 text-sm">
                      <span className="shrink-0 font-mono text-ink-subtle">{i + 1}.</span>
                      <div className="min-w-0">
                        <p className="font-medium text-ink">{step.label}</p>
                        <p className="text-ink-muted">{step.detail}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </ResultBlock>
            )}

            <ResultBlock label="Knowledge yang dipakai">
              {result.knowledgeRefs?.sourceTopic ? (
                <p className="text-base text-ink">{result.knowledgeRefs.sourceTopic}</p>
              ) : (
                <p className="text-base text-ink-muted">Tidak ada topik knowledge yang dilaporkan.</p>
              )}
            </ResultBlock>

            <ResultBlock label="Verifikasi">
              {result.verification ? (
                <pre className="overflow-x-auto rounded-sm border border-line bg-surface-sunken p-2 text-xs text-ink">
                  {JSON.stringify(result.verification, null, 2)}
                </pre>
              ) : (
                <p className="text-base text-ink-muted">
                  Decision engine tidak melaporkan hasil verifikasi terpisah untuk putaran ini.
                </p>
              )}
            </ResultBlock>

            {result.decisionRunId && (
              <div className="px-4 py-3">
                <Link
                  href={`/bot-control/decisions?run=${result.decisionRunId}`}
                  className="focus-ring rounded-sm text-sm text-accent hover:underline"
                >
                  Lihat di Decision Logs →
                </Link>
              </div>
            )}
          </div>
        </Card>
        )}
      </div>
    </div>
  )
}

/** Satu blok hasil simulasi. Label kalimat biasa, dipisah garis rambut dari blok di atasnya. */
function ResultBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1 px-4 py-3">
      <p className="text-xs font-medium text-ink-subtle">{label}</p>
      {children}
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
