'use client'
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { FlowStepList } from '@/components/bot-control/FlowStepList'
import { FLOW_NODE_TYPE_LABEL } from '@/components/bot-control/FlowStepCard'
import { FlowSafeConfigEditor } from '@/components/bot-control/FlowSafeConfigEditor'
import { fetchJson } from '@/lib/fetch-json'
import type { ExistingFlowDefinition, ExistingFlowNode } from '@/lib/bot-control/existing-flow-registry'
import type { FlowSafeConfig, SafeConfigField } from '@/lib/bot-control/flow-config'
import { getBotRule } from '@/lib/bot-control/rule-registry'

type FlowSummary = {
  key: string
  name: string
  version: number
  description: string
  nodesCount: number
  status: string
  editableLevel: string
  editableFields: SafeConfigField[]
  runtimeSource: string
  activeVersion: number | null
  draftVersion: { id: string; version: number; status: string } | null
  managementUnavailable?: true
}

type FlowDetail = ExistingFlowDefinition & {
  editableLevel: string
  editableFields: SafeConfigField[]
  activeVersion: { id: string; version: number; config: FlowSafeConfig | null } | null
  draftVersion: { id: string; version: number; status: string; config: FlowSafeConfig | null } | null
}

type Session = { role: 'ADMIN' | 'AGENT' }

const DRAFT_STATUS_VARIANT: Record<string, 'brand' | 'warning' | 'success'> = {
  DRAFT: 'brand',
  REVIEW: 'warning',
  APPROVED: 'success',
}

/** SDD Manage Second §8.3. */
const MIN_REASON_LENGTH = 10

export default function FlowMapPage() {
  const [flows, setFlows] = useState<FlowSummary[]>([])
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [flow, setFlow] = useState<FlowDetail | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [role, setRole] = useState<Session['role'] | null>(null)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  const reload = useCallback(() => setReloadToken((n) => n + 1), [])

  useEffect(() => {
    fetchJson<{ flows: FlowSummary[] }>('/api/bot-control/flows')
      .then((data) => {
        setFlows(data.flows)
        setActiveKey((current) => current ?? data.flows[0]?.key ?? null)
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Gagal memuat daftar flow'))
      .finally(() => setLoading(false))
  }, [reloadToken])

  // The API enforces the permission matrix; this only avoids showing an AGENT controls whose
  // every press would 403.
  useEffect(() => {
    fetchJson<Session>('/api/session')
      .then((s) => setRole(s.role))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!activeKey) return
    let cancelled = false
    fetchJson<FlowDetail>(`/api/bot-control/flows/${encodeURIComponent(activeKey)}`)
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
  }, [activeKey, reloadToken])

  async function saveDraft(config: FlowSafeConfig, reason: string) {
    if (!activeKey || saving) return
    setSaving(true)
    setActionError(null)
    try {
      await fetchJson(`/api/bot-control/flows/${encodeURIComponent(activeKey)}/draft`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config, reason }),
      })
      setEditing(false)
      reload()
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Gagal menyimpan draft flow')
    } finally {
      setSaving(false)
    }
  }

  async function runTransition(action: 'request-review' | 'approve' | 'reject') {
    if (!activeKey) return
    const body: { reason?: string } = {}
    if (action === 'reject') {
      const typed = window.prompt(`Alasan menolak draft ini? (minimal ${MIN_REASON_LENGTH} karakter)`)?.trim()
      if (!typed || typed.length < MIN_REASON_LENGTH) return
      body.reason = typed
    }

    setActionError(null)
    try {
      await fetchJson(`/api/bot-control/flows/${encodeURIComponent(activeKey)}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      reload()
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Gagal memproses permintaan')
    }
  }

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
          Langkah-langkah pipeline bot yang berjalan hari ini. Peta langkahnya read-only &mdash; itu control flow di
          kode, bukan data. Yang bisa diubah dari sini hanyalah teks dan ambang yang dibaca kode apa adanya.
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
                <span className="block text-xs text-muted-foreground">
                  {f.activeVersion ? `Config v${f.activeVersion}` : 'Config dari kode'}
                  {f.draftVersion && ` · draft v${f.draftVersion.version} (${f.draftVersion.status})`}
                </span>
              </button>
            ))}
          </Card>

          <div className="space-y-3">
            {flow && (
              <Card className="space-y-2 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Konfigurasi aman</p>
                  <Badge variant="muted">{flow.editableLevel}</Badge>
                  {flow.draftVersion && (
                    <Badge variant={DRAFT_STATUS_VARIANT[flow.draftVersion.status] ?? 'muted'}>
                      draft v{flow.draftVersion.version}: {flow.draftVersion.status}
                    </Badge>
                  )}
                </div>

                <p className="text-xs text-muted-foreground">
                  {flow.activeVersion
                    ? `Berjalan dengan konfigurasi v${flow.activeVersion.version}.`
                    : 'Berjalan dengan kalimat bawaan dari kode.'}
                </p>

                {/* No controls at all when the level permits nothing. An inert form is worse
                    than none: an operator will believe they changed the bot. */}
                {flow.editableFields.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Flow ini belum bisa dikonfigurasi dari UI (level {flow.editableLevel}).
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {role === 'ADMIN' && (
                      <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                        {flow.draftVersion ? 'Ubah draft' : 'Buat draft'}
                      </Button>
                    )}
                    {/* Each control follows the draft's STATE, not just the role: a button that
                        always 409s teaches an operator to stop trusting the page. */}
                    {role === 'ADMIN' && flow.draftVersion?.status === 'DRAFT' && (
                      <Button variant="outline" size="sm" onClick={() => runTransition('request-review')}>
                        Kirim ke review
                      </Button>
                    )}
                    {role === 'ADMIN' && flow.draftVersion?.status === 'REVIEW' && (
                      <Button variant="outline" size="sm" onClick={() => runTransition('approve')}>
                        Approve
                      </Button>
                    )}
                    {role === 'ADMIN' && flow.draftVersion && (
                      <Button variant="outline" size="sm" onClick={() => runTransition('reject')}>
                        Reject
                      </Button>
                    )}
                    {flow.draftVersion?.status === 'APPROVED' && (
                      <span className="text-xs text-muted-foreground">Menunggu publish lewat Releases</span>
                    )}
                  </div>
                )}

                {actionError && <p className="text-xs text-destructive">{actionError}</p>}
              </Card>
            )}

            <Card className="p-3">
              {flow ? (
                <FlowStepList nodes={flow.nodes} selectedId={selectedNodeId} onSelect={setSelectedNodeId} />
              ) : (
                <p className="text-sm text-muted-foreground">Pilih flow untuk melihat langkahnya.</p>
              )}
            </Card>
          </div>

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

      {editing && flow && (
        <FlowSafeConfigEditor
          flowName={flow.name}
          fields={flow.editableFields}
          // Seeds from the pending draft when there is one, otherwise from what is live, so
          // changing one field does not silently reset the others.
          initial={flow.draftVersion?.config ?? flow.activeVersion?.config ?? {}}
          saving={saving}
          error={actionError}
          onCancel={() => setEditing(false)}
          onSave={saveDraft}
        />
      )}
    </main>
  )
}
