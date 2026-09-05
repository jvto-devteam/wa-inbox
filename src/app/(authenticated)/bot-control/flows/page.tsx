'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { FlowStepList } from '@/components/bot-control/FlowStepList'
import { FLOW_NODE_TYPE_LABEL } from '@/components/bot-control/FlowStepCard'
import { fetchJson } from '@/lib/fetch-json'
import type { ExistingFlowDefinition, ExistingFlowNode } from '@/lib/bot-control/existing-flow-registry'
import { getBotRule } from '@/lib/bot-control/rule-registry'

type FlowSummary = { key: string; name: string; version: number; description: string; nodesCount: number; status: string }

export default function FlowMapPage() {
  const [flows, setFlows] = useState<FlowSummary[]>([])
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [flow, setFlow] = useState<ExistingFlowDefinition | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchJson<{ flows: FlowSummary[] }>('/api/bot-control/flows')
      .then((data) => {
        setFlows(data.flows)
        setActiveKey((current) => current ?? data.flows[0]?.key ?? null)
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Gagal memuat daftar flow'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!activeKey) return
    let cancelled = false
    fetchJson<ExistingFlowDefinition>(`/api/bot-control/flows/${encodeURIComponent(activeKey)}`)
      .then((data) => {
        if (cancelled) return
        setFlow(data)
        // Langkah pertama dipilih otomatis supaya panel kanan tidak pernah kosong saat
        // halaman dibuka. Pilihan sebelumnya dibuang, bukan dipertahankan: id node dari flow
        // lain akan menghasilkan panel detail yang tidak cocok dengan daftar di sebelahnya.
        setSelectedNodeId(data.nodes[0]?.id ?? null)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Gagal memuat flow')
      })
    return () => {
      cancelled = true
    }
  }, [activeKey])

  const selectedNode: ExistingFlowNode | null = flow?.nodes.find((n) => n.id === selectedNodeId) ?? null
  const outgoingEdges = flow?.edges.filter((e) => e.from === selectedNodeId) ?? []

  return (
    <main className="mx-auto max-w-6xl space-y-4 p-6">
      <div className="space-y-1">
        <Link href="/bot-control" className="text-sm text-brand hover:underline">
          &larr; Kembali ke Bot Control
        </Link>
        <h1 className="text-xl font-semibold text-navy">Flow Map</h1>
        <p className="text-sm text-muted-foreground">
          Gambaran read-only dari pipeline bot yang berjalan hari ini. Halaman ini tidak mengubah apa pun.
        </p>
      </div>

      {loading && <p className="text-sm text-muted-foreground">Memuat...</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}

      {!loading && !error && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_minmax(0,20rem)]">
          <Card className="h-fit space-y-2 p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Flow</p>
            {flows.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setActiveKey(f.key)}
                aria-pressed={f.key === activeKey}
                className={`w-full rounded-lg border p-2 text-left text-sm ${
                  f.key === activeKey ? 'border-brand bg-brand/5 font-medium text-navy' : 'border-border hover:bg-muted/50'
                }`}
              >
                {f.name}
                <span className="block text-xs text-muted-foreground">
                  v{f.version} &middot; {f.nodesCount} langkah &middot; {f.status}
                </span>
              </button>
            ))}
          </Card>

          <Card className="p-3">
            {flow ? (
              <FlowStepList nodes={flow.nodes} selectedId={selectedNodeId} onSelect={setSelectedNodeId} />
            ) : (
              <p className="text-sm text-muted-foreground">Pilih flow untuk melihat langkahnya.</p>
            )}
          </Card>

          <Card className="h-fit space-y-3 p-4">
            {selectedNode ? (
              <>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Langkah</p>
                  <p className="text-sm font-semibold text-navy">{selectedNode.name}</p>
                  <Badge variant="muted" className="mt-1">{FLOW_NODE_TYPE_LABEL[selectedNode.type]}</Badge>
                </div>

                <p className="text-sm text-foreground">{selectedNode.description}</p>

                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Sumber kode</p>
                  <p className="font-mono text-xs break-all text-foreground">{selectedNode.sourceFile}</p>
                  {selectedNode.sourceRef && (
                    <p className="font-mono text-xs text-muted-foreground">{selectedNode.sourceRef}()</p>
                  )}
                </div>

                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Kemungkinan hasil</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-foreground">
                    {selectedNode.possibleOutputs.map((output) => (
                      <li key={output}>{output}</li>
                    ))}
                  </ul>
                </div>

                {outgoingEdges.length > 0 && (
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Lanjut ke</p>
                    <ul className="mt-1 space-y-0.5 text-xs text-foreground">
                      {outgoingEdges.map((edge) => (
                        <li key={`${edge.from}-${edge.to}-${edge.condition ?? ''}`}>
                          <span className="font-mono">{edge.to}</span>
                          {edge.condition && <span className="text-muted-foreground"> — {edge.condition}</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {selectedNode.relatedRuleKeys && selectedNode.relatedRuleKeys.length > 0 && (
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Aturan terkait</p>
                    <ul className="mt-1 space-y-0.5 text-xs">
                      {selectedNode.relatedRuleKeys.map((key) => (
                        <li key={key}>
                          <Link href="/bot-control/rules" className="text-brand hover:underline">
                            {getBotRule(key)?.name ?? key}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Pilih satu langkah untuk melihat detailnya.</p>
            )}
          </Card>
        </div>
      )}
    </main>
  )
}
