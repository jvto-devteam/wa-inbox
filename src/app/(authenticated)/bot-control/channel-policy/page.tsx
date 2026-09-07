'use client'
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { roleNameCan } from '@/lib/bot-control/permissions'
import type { AccountRoleName } from '@/lib/auth/session'
import type { ChannelPolicyDraft } from '@/lib/bot-control/channel-policy-config'
import { fetchJson } from '@/lib/fetch-json'

type Session = { role: AccountRoleName }

type PolicyResponse = {
  key: string
  status: string
  active: ChannelPolicyDraft
  draft: ChannelPolicyDraft | null
  warnings: string[]
  bounds: Record<string, { min: number; max: number }>
  capabilityKeys: string[]
  capabilityTargets: string[]
}

const STATUS_VARIANT: Record<string, 'success' | 'brand' | 'warning' | 'destructive'> = {
  PUBLISHED: 'success',
  DRAFT: 'brand',
  REVIEW: 'warning',
  APPROVED: 'brand',
  REJECTED: 'destructive',
}

const SAFETY_LABEL: Record<string, string> = {
  campaignRatePerMinute: 'Batas campaign per menit',
  duplicateWindowMs: 'Jendela deteksi duplikat (ms)',
  providerFailureThreshold: 'Ambang kegagalan provider',
  providerFailureWindowMs: 'Jendela kegagalan provider (ms)',
}

/** SDD Manage Second §8: a change with no stated reason answers nothing later. */
const MIN_REASON_LENGTH = 10

/**
 * The channel policy page.
 *
 * This is the most consequential editor in Bot Control: `defaultOutbound` decides which channel
 * every agent and bot reply leaves on, and the safety numbers decide whether the duplicate
 * check and the campaign limiter do anything. So the warnings are rendered before the form, not
 * after it, and the OFFICIAL warning is styled as a warning rather than as help text.
 *
 * Nothing here refuses a choice. Routing everything through Official is a legitimate thing to
 * have to do in an incident, and an editor that forbade it would just be bypassed by editing
 * the database. What it must not be is silent.
 */
export default function ChannelPolicyPage() {
  const [data, setData] = useState<PolicyResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [role, setRole] = useState<Session['role'] | null>(null)

  const [draft, setDraft] = useState<ChannelPolicyDraft | null>(null)
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const load = useCallback(
    () =>
      fetchJson<PolicyResponse>('/api/bot-control/channel-policy')
        .then((response) => {
          setData(response)
          // Seeds from the pending draft when there is one, otherwise from what is live, so
          // changing one field does not silently reset the others.
          setDraft(response.draft ?? response.active)
          setError(null)
        })
        .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Gagal memuat kebijakan channel'))
        .finally(() => setLoading(false)),
    []
  )

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    fetchJson<Session>('/api/session')
      .then((s) => setRole(s.role))
      .catch(() => {})
  }, [])

  const canEdit = roleNameCan(role, 'EDIT_FLOW_CONFIG')
  const canApprove = roleNameCan(role, 'APPROVE')

  async function saveDraft() {
    if (!draft || saving || reason.trim().length < MIN_REASON_LENGTH) return
    setSaving(true)
    setActionError(null)
    try {
      await fetchJson('/api/bot-control/channel-policy/draft', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: draft, reason: reason.trim() }),
      })
      setReason('')
      await load()
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Gagal menyimpan draft kebijakan')
    } finally {
      setSaving(false)
    }
  }

  async function runTransition(action: 'request-review' | 'approve' | 'reject') {
    const body: { reason?: string } = {}
    if (action === 'reject') {
      const typed = window.prompt(`Alasan menolak draft kebijakan? (minimal ${MIN_REASON_LENGTH} karakter)`)?.trim()
      if (!typed || typed.length < MIN_REASON_LENGTH) return
      body.reason = typed
    }

    setActionError(null)
    try {
      await fetchJson(`/api/bot-control/channel-policy/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      await load()
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Gagal memproses permintaan')
    }
  }

  function setSafety(field: string, value: string) {
    if (!draft) return
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return
    setDraft({ ...draft, safetyConfig: { ...draft.safetyConfig, [field]: parsed } })
  }

  return (
    <main className="mx-auto max-w-5xl space-y-4 p-6">
      <div className="space-y-1">
        <Link href="/bot-control" className="text-sm text-brand hover:underline">
          &larr; Kembali ke Bot Control
        </Link>
        <h1 className="text-xl font-semibold text-navy">Channel Policy</h1>
        <p className="text-sm text-muted-foreground">
          Channel mana yang membawa apa, dan seberapa ketat pengaman outbound. Ini yang benar-benar dibaca{' '}
          <span className="font-mono">resolveChannel</span> dan safety guard saat mengirim.
        </p>
        <p className="text-xs text-muted-foreground">
          Perubahan disimpan sebagai draft dan baru berlaku setelah dipublish lewat{' '}
          <Link href="/bot-control/releases" className="text-brand hover:underline">
            Releases
          </Link>
          .
        </p>
      </div>

      {loading && <p className="text-sm text-muted-foreground">Memuat...</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {actionError && <p className="text-sm text-destructive">{actionError}</p>}

      {!loading && !error && data && draft && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={STATUS_VARIANT[data.status] ?? 'muted'}>{data.status}</Badge>
            <span className="text-xs text-muted-foreground">
              Berlaku sekarang: default outbound <strong>{data.active.defaultOutbound}</strong>
            </span>
          </div>

          {/* Before the form, not after it: an operator about to route every reply through Meta
              should read this before they reach the save button. */}
          {data.warnings.length > 0 && (
            <Card className="space-y-1 border-amber-300 bg-amber-50 p-3">
              <p className="text-xs font-semibold text-amber-800">Perlu diperhatikan</p>
              <ul className="list-inside list-disc text-xs text-amber-900">
                {data.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </Card>
          )}

          <Card className="space-y-3 p-4">
            <h2 className="text-sm font-semibold text-navy">Default outbound</h2>
            <Select
              value={draft.defaultOutbound}
              onChange={(e) =>
                setDraft({ ...draft, defaultOutbound: e.target.value as ChannelPolicyDraft['defaultOutbound'] })
              }
              disabled={!canEdit}
              aria-label="Default outbound"
              className="w-52"
            >
              <option value="UNOFFICIAL">UNOFFICIAL</option>
              <option value="OFFICIAL">OFFICIAL</option>
            </Select>
            {draft.defaultOutbound === 'OFFICIAL' && (
              <p className="text-xs text-destructive">
                Kebijakan tertulis di CLAUDE.md adalah UNOFFICIAL. Mengubah ini membuat semua balasan agent dan bot
                lewat Meta, dengan biaya per-percakapan dan jendela 24 jam yang mengikutinya.
              </p>
            )}
          </Card>

          <Card className="p-0">
            <div className="p-3">
              <h2 className="text-sm font-semibold text-navy">Matrix kemampuan</h2>
              <p className="text-xs text-muted-foreground">
                Channel mana yang membawa tiap kemampuan. Kemampuan yang ada ditentukan kode; di sini hanya channelnya.
              </p>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Kemampuan</TableHead>
                  <TableHead>Berlaku sekarang</TableHead>
                  <TableHead>Draft</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.capabilityKeys.map((key) => (
                  <TableRow key={key}>
                    <TableCell className="font-mono text-xs text-navy">{key}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {data.active.capabilityRules[key as keyof typeof data.active.capabilityRules] ?? '—'}
                    </TableCell>
                    <TableCell>
                      <Select
                        value={String(draft.capabilityRules[key as keyof typeof draft.capabilityRules] ?? '')}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            capabilityRules: { ...draft.capabilityRules, [key]: e.target.value },
                          } as ChannelPolicyDraft)
                        }
                        disabled={!canEdit}
                        aria-label={`Channel untuk ${key}`}
                        className="w-52"
                      >
                        {data.capabilityTargets.map((target) => (
                          <option key={target} value={target}>
                            {target}
                          </option>
                        ))}
                      </Select>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          <Card className="space-y-3 p-4">
            <div>
              <h2 className="text-sm font-semibold text-navy">Pengaman outbound</h2>
              <p className="text-xs text-muted-foreground">
                Angka-angka ini dibaca safety guard saat mengirim. Batas bawahnya bukan hiasan: nol pada batas campaign
                mematikan gerbangnya sama sekali.
              </p>
            </div>

            {Object.keys(SAFETY_LABEL).map((field) => (
              <label key={field} className="block space-y-1 text-sm">
                <span className="text-xs text-muted-foreground">{SAFETY_LABEL[field]}</span>
                <Input
                  type="number"
                  min={data.bounds[field]?.min}
                  max={data.bounds[field]?.max}
                  value={String(draft.safetyConfig[field as keyof typeof draft.safetyConfig] ?? '')}
                  onChange={(e) => setSafety(field, e.target.value)}
                  disabled={!canEdit}
                  aria-label={SAFETY_LABEL[field]}
                  className="w-52"
                />
                {data.bounds[field] && (
                  <span className="block text-xs text-muted-foreground">
                    Antara {data.bounds[field].min} dan {data.bounds[field].max}.
                  </span>
                )}
              </label>
            ))}

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.safetyConfig.quietHoursEnabled}
                onChange={(e) =>
                  setDraft({ ...draft, safetyConfig: { ...draft.safetyConfig, quietHoursEnabled: e.target.checked } })
                }
                disabled={!canEdit}
                aria-label="Aktifkan jam tenang"
              />
              Aktifkan jam tenang
            </label>
          </Card>

          {canEdit && (
            <Card className="space-y-3 p-4">
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Alasan perubahan, minimal 10 karakter"
                aria-label="Alasan perubahan"
                rows={2}
              />
              <div className="flex flex-wrap gap-2">
                <Button type="button" onClick={saveDraft} disabled={saving || reason.trim().length < MIN_REASON_LENGTH}>
                  {saving ? 'Menyimpan...' : 'Simpan draft'}
                </Button>
                {/* Each control follows the STATE, not just the role: a button that always 409s
                    teaches an operator to stop trusting the page. */}
                {data.status === 'DRAFT' && (
                  <Button type="button" variant="outline" onClick={() => runTransition('request-review')}>
                    Kirim ke review
                  </Button>
                )}
                {canApprove && data.status === 'REVIEW' && (
                  <Button type="button" variant="outline" onClick={() => runTransition('approve')}>
                    Approve
                  </Button>
                )}
                {canApprove && data.draft && (
                  <Button type="button" variant="outline" onClick={() => runTransition('reject')}>
                    Reject
                  </Button>
                )}
                {data.status === 'APPROVED' && (
                  <span className="self-center text-xs text-muted-foreground">Menunggu publish lewat Releases</span>
                )}
              </div>
            </Card>
          )}
        </>
      )}
    </main>
  )
}
