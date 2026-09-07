'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Modal } from '@/components/ui/modal'
import { RuleRegistryTable, type RuleRow, type RuleAction } from '@/components/bot-control/RuleRegistryTable'
import { fetchJson } from '@/lib/fetch-json'

type Session = { role: 'ADMIN' | 'AGENT' }

/** SDD Manage Second §8.1: a rule change with no stated reason answers nothing later. */
const MIN_REASON_LENGTH = 10

/** Config fields the form knows how to render, keyed by field name. */
const FIELD_OPTIONS: Record<string, readonly string[]> = {
  liveDefaultChannel: ['UNOFFICIAL', 'OFFICIAL'],
}

export default function RulesRegistryPage() {
  const [rules, setRules] = useState<RuleRow[]>([])
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [role, setRole] = useState<Session['role'] | null>(null)

  const [editing, setEditing] = useState<RuleRow | null>(null)
  const [draftEnabled, setDraftEnabled] = useState(true)
  const [draftConfig, setDraftConfig] = useState<Record<string, string>>({})
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const load = useCallback(
    () =>
      fetchJson<{ rules: RuleRow[] }>('/api/bot-control/rules')
        .then((data) => {
          setRules(data.rules)
          setError(null)
        })
        .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Gagal memuat aturan'))
        .finally(() => setLoading(false)),
    []
  )

  useEffect(() => {
    void load()
  }, [load])

  // The API enforces the permission matrix; this only avoids showing an AGENT buttons whose
  // every press would 403.
  useEffect(() => {
    fetchJson<Session>('/api/session')
      .then((s) => setRole(s.role))
      .catch(() => {})
  }, [])

  // Difilter di klien, sengaja: seluruh registry ada sepuluh baris dan dimuat sekali. Menaruh
  // filter di server hanya menambah round-trip per ketikan tanpa mengurangi apa pun yang
  // dikirim.
  const categories = useMemo(() => [...new Set(rules.map((r) => r.category))], [rules])
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return rules.filter((rule) => {
      if (category && rule.category !== category) return false
      if (!needle) return true
      return (
        rule.name.toLowerCase().includes(needle) ||
        rule.key.toLowerCase().includes(needle) ||
        rule.description.toLowerCase().includes(needle)
      )
    })
  }, [rules, query, category])

  function openEditor(rule: RuleRow) {
    setEditing(rule)
    setActionError(null)
    setReason('')
    // Seeds from the pending draft when there is one, otherwise from what is live. Starting a
    // fresh form from the live values is what makes "change one field" not silently reset the
    // others.
    setDraftEnabled(rule.draftEnabled ?? rule.enabled)
    const seed: Record<string, string> = {}
    for (const field of rule.editSurface?.fields ?? []) {
      const current = rule.draftConfig?.[field] ?? rule.config?.[field]
      seed[field] = typeof current === 'string' ? current : ''
    }
    setDraftConfig(seed)
  }

  async function runTransition(rule: RuleRow, action: Exclude<RuleAction, 'edit'>) {
    // Reject is the one transition that demands an explanation, and it is also the one an
    // operator is most likely to fire off in a hurry — so it is asked for up front.
    const body: { reason?: string } = {}
    if (action === 'reject') {
      const typed = window.prompt('Alasan menolak draft ini? (minimal 10 karakter)')?.trim()
      if (!typed || typed.length < MIN_REASON_LENGTH) return
      body.reason = typed
    }

    setActionError(null)
    try {
      await fetchJson(`/api/bot-control/rules/${encodeURIComponent(rule.key)}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      await load()
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Gagal memproses permintaan')
    }
  }

  function handleAction(rule: RuleRow, action: RuleAction) {
    if (action === 'edit') return openEditor(rule)
    void runTransition(rule, action)
  }

  async function saveDraft() {
    if (!editing || saving || reason.trim().length < MIN_REASON_LENGTH) return
    setSaving(true)
    setActionError(null)
    try {
      await fetchJson(`/api/bot-control/rules/${encodeURIComponent(editing.key)}/draft`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: draftEnabled,
          // Only the fields this rule declares. Sending anything else is rejected by the API
          // rather than stored and ignored, which from here would look identical to working.
          config: Object.fromEntries((editing.editSurface?.fields ?? []).map((f) => [f, draftConfig[f]])),
          reason: reason.trim(),
        }),
      })
      setEditing(null)
      await load()
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Gagal menyimpan draft')
    } finally {
      setSaving(false)
    }
  }

  const canEdit = role === 'ADMIN'
  const canApprove = role === 'ADMIN'

  return (
    <main className="mx-auto max-w-6xl space-y-4 p-6">
      <div className="space-y-1">
        <Link href="/bot-control" className="text-sm text-brand hover:underline">
          &larr; Kembali ke Bot Control
        </Link>
        <h1 className="text-xl font-semibold text-navy">Rules Registry</h1>
        <p className="text-sm text-muted-foreground">
          Aturan yang benar-benar mengikat bot hari ini, beserta file yang menegakkannya. Aturan bertanda &ldquo;Dapat
          diubah&rdquo; bisa didraft di sini; sisanya terkunci di kode.
        </p>
        {/* Stated plainly, because a draft that looks applied is the failure mode of this whole
            workflow: an operator who thinks they turned something off walks away. */}
        <p className="text-xs text-muted-foreground">
          Draft tidak mengubah perilaku bot. Perubahan baru berlaku setelah dipublish lewat{' '}
          <Link href="/bot-control/releases" className="text-brand hover:underline">
            Releases
          </Link>
          .
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Cari aturan..."
          aria-label="Cari aturan"
          className="w-64"
        />
        <Select value={category} onChange={(e) => setCategory(e.target.value)} className="w-auto" aria-label="Filter kategori">
          <option value="">Semua kategori</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
      </div>

      {loading && <p className="text-sm text-muted-foreground">Memuat...</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {actionError && <p className="text-sm text-destructive">{actionError}</p>}
      {!loading && !error && (
        <Card className="p-3">
          <RuleRegistryTable rules={visible} canEdit={canEdit} canApprove={canApprove} onAction={handleAction} />
        </Card>
      )}

      {editing && (
        <Modal onClose={() => setEditing(null)} className="w-full max-w-lg space-y-3 p-4">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold text-navy">{editing.name}</h2>
            <p className="font-mono text-xs text-muted-foreground">{editing.key}</p>
          </div>

          {/* No toggle at all when the rule may only be reconfigured. An inert switch that
              appears to work is worse than no switch. */}
          {editing.editSurface?.canToggleEnabled ? (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={draftEnabled} onChange={(e) => setDraftEnabled(e.target.checked)} />
              Aktifkan aturan ini
            </label>
          ) : (
            <p className="text-xs text-muted-foreground">
              Aturan ini tidak bisa dimatikan dari sini — hanya nilainya yang bisa diubah.
            </p>
          )}

          {(editing.editSurface?.fields ?? []).map((field) => (
            <label key={field} className="block space-y-1 text-sm">
              <span className="font-mono text-xs text-muted-foreground">{field}</span>
              {FIELD_OPTIONS[field] ? (
                <Select
                  value={draftConfig[field] ?? ''}
                  onChange={(e) => setDraftConfig((prev) => ({ ...prev, [field]: e.target.value }))}
                  aria-label={field}
                >
                  {FIELD_OPTIONS[field].map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </Select>
              ) : (
                <Input
                  value={draftConfig[field] ?? ''}
                  onChange={(e) => setDraftConfig((prev) => ({ ...prev, [field]: e.target.value }))}
                  aria-label={field}
                />
              )}
            </label>
          ))}

          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Alasan perubahan, minimal 10 karakter"
            aria-label="Alasan perubahan"
            rows={3}
          />
          {actionError && <p className="text-xs text-destructive">{actionError}</p>}

          <div className="flex items-center gap-2">
            <Button type="button" onClick={saveDraft} disabled={saving || reason.trim().length < MIN_REASON_LENGTH}>
              {saving ? 'Menyimpan...' : 'Simpan draft'}
            </Button>
            <Button type="button" variant="outline" onClick={() => setEditing(null)}>
              Batal
            </Button>
          </div>
        </Modal>
      )}
    </main>
  )
}
