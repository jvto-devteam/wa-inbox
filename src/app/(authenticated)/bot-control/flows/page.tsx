'use client'
import { useState } from 'react'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { FlowStepList } from '@/components/bot-control/FlowStepList'
import { FLOW_NODE_TYPE_LABEL } from '@/components/bot-control/FlowStepCard'
import {
  EXISTING_FLOWS,
  type ExistingFlowDefinition,
  type ExistingFlowNode,
} from '@/lib/bot-control/existing-flow-registry'
import { getBotRule } from '@/lib/bot-control/rule-registry'

/**
 * The pipeline, as a map. Nothing on this page changes anything.
 *
 * It reads `existing-flow-registry.ts` directly rather than through an API, because that file
 * IS the answer: a hand-written description of control flow in `orchestrator.ts` and
 * `inbound.ts`, kept honest by `existing-flow-registry.test.ts` asserting every `sourceFile`
 * still exists. There is no database row that could add anything to it.
 *
 * There used to be an editor here — a draft/review/approve/publish cycle over a versioned flow
 * table, for one row holding two sentences. Those two sentences now live in `Settings` and are
 * edited on /chatbot with the same save-and-it-is-live pattern as the bot on/off switch. What
 * is left is the part that was always worth having: documentation of what the bot actually does.
 */
export default function FlowMapPage() {
  const [activeKey, setActiveKey] = useState<string>(EXISTING_FLOWS[0]?.key ?? '')
  const flow: ExistingFlowDefinition | null = EXISTING_FLOWS.find((f) => f.key === activeKey) ?? null
  // Never null while a flow is selected, so the detail panel is never empty on first paint.
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(EXISTING_FLOWS[0]?.nodes[0]?.id ?? null)

  const selectedNode: ExistingFlowNode | null = flow?.nodes.find((n) => n.id === selectedNodeId) ?? null
  const outgoingEdges = flow?.edges.filter((e) => e.from === selectedNodeId) ?? []

  function selectFlow(key: string) {
    setActiveKey(key)
    // The previous selection is dropped rather than kept: a node id from another flow would
    // render a detail panel that does not match the list beside it.
    setSelectedNodeId(EXISTING_FLOWS.find((f) => f.key === key)?.nodes[0]?.id ?? null)
  }

  return (
    <main className="mx-auto max-w-6xl space-y-4 p-6">
      <div className="space-y-1">
        <Link href="/bot-control" className="text-sm text-brand hover:underline">
          &larr; Kembali ke Bot Control
        </Link>
        <h1 className="text-xl font-semibold text-navy">Flow Map</h1>
        <p className="text-sm text-muted-foreground">
          Langkah-langkah pipeline bot yang berjalan hari ini. Seluruh halaman ini read-only &mdash; percabangannya
          adalah control flow di kode, bukan data. Dua kalimat bot yang bisa diubah tanpa deploy (balasan saat bot
          tidak tahu jawabannya dan kalimat saat percakapan dialihkan ke manusia) ada di halaman{' '}
          <Link href="/chatbot" className="text-brand hover:underline">
            Chatbot
          </Link>
          .
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_minmax(0,20rem)]">
        <Card className="h-fit space-y-2 p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Flow</p>
          {EXISTING_FLOWS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => selectFlow(f.key)}
              aria-pressed={f.key === activeKey}
              className={`w-full rounded-lg border p-2 text-left text-sm ${
                f.key === activeKey ? 'border-brand bg-brand/5 font-medium text-navy' : 'border-border hover:bg-muted/50'
              }`}
            >
              {f.name}
              <span className="block text-xs text-muted-foreground">
                v{f.version} &middot; {f.nodes.length} langkah
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
    </main>
  )
}
