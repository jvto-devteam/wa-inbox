'use client'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Modal } from '@/components/ui/modal'
import { TRIAGE_ISSUE_TYPES, TRIAGE_SEVERITIES, TRIAGE_STATUSES } from '@/lib/bot-control/triage-types'

export type TriageRow = {
  id: string
  decisionRunId: string
  status: string
  issueType: string | null
  severity: string
  assignedTo: string | null
  assignedToName?: string | null
  note: string | null
  linkedEntityType: string | null
  linkedEntityId: string | null
  resolvedBy: string | null
  resolvedAt: string | null
}

export const TRIAGE_STATUS_VARIANT: Record<string, 'brand' | 'warning' | 'success' | 'muted'> = {
  OPEN: 'brand',
  ASSIGNED: 'warning',
  RESOLVED: 'success',
  IGNORED: 'muted',
}

export const TRIAGE_ISSUE_LABEL: Record<string, string> = {
  KNOWLEDGE_GAP: 'Knowledge kurang',
  WRONG_FLOW: 'Flow salah',
  BAD_REPLY: 'Balasan buruk',
  HALLUCINATION_BLOCKED: 'Halusinasi tertahan',
  UNNECESSARY_HANDOFF: 'Handoff tak perlu',
  MISSED_HANDOFF: 'Handoff terlewat',
  PROVIDER_FAILURE: 'Provider gagal',
  OTHER: 'Lainnya',
}

export type TriageDraft = {
  status: string
  issueType: string
  severity: string
  assignedTo: string
  note: string
  linkedEntityType: string
  linkedEntityId: string
}

/**
 * The triage form for one decision.
 *
 * `canAssignOthers` and `canClose` come from the caller's role, and their absence removes the
 * controls entirely rather than disabling them. The API enforces the same two rules (triage.ts);
 * this only keeps an agent from filling in a field whose save would 403 — which is a worse
 * experience than never being offered it.
 *
 * "Ambil sendiri" exists as its own button because taking a piece of work is the one assignment
 * an agent may make, and burying it inside a dropdown of every account would make it look like
 * a permission they do not have.
 */
export function TriagePanel({
  existing,
  currentUserId,
  accounts,
  canAssignOthers,
  canClose,
  saving,
  error,
  onCancel,
  onSave,
}: {
  existing: TriageRow | null
  currentUserId: string
  accounts: { id: string; name: string }[]
  canAssignOthers: boolean
  canClose: boolean
  saving: boolean
  error: string | null
  onCancel: () => void
  onSave: (draft: TriageDraft) => void
}) {
  const [draft, setDraft] = useState<TriageDraft>({
    status: existing?.status ?? 'OPEN',
    issueType: existing?.issueType ?? '',
    severity: existing?.severity ?? 'NORMAL',
    assignedTo: existing?.assignedTo ?? '',
    note: existing?.note ?? '',
    linkedEntityType: existing?.linkedEntityType ?? '',
    linkedEntityId: existing?.linkedEntityId ?? '',
  })

  const statusOptions = canClose ? TRIAGE_STATUSES : TRIAGE_STATUSES.filter((s) => s === 'OPEN' || s === 'ASSIGNED')

  return (
    <Modal onClose={onCancel} className="max-h-[85vh] w-full max-w-lg space-y-3 overflow-y-auto p-4">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold text-navy">Tindak lanjut keputusan</h2>
        <p className="text-xs text-muted-foreground">
          Menandai masalah untuk ditangani. Ini tidak mengubah bot — perbaikannya dibuat terpisah lewat Knowledge,
          Rules, atau Flows.
        </p>
      </div>

      <label className="block space-y-1 text-sm">
        <span className="text-xs text-muted-foreground">Jenis masalah</span>
        <Select
          value={draft.issueType}
          onChange={(e) => setDraft({ ...draft, issueType: e.target.value })}
          aria-label="Jenis masalah"
        >
          <option value="">Belum ditentukan</option>
          {TRIAGE_ISSUE_TYPES.map((type) => (
            <option key={type} value={type}>
              {TRIAGE_ISSUE_LABEL[type] ?? type}
            </option>
          ))}
        </Select>
      </label>

      <label className="block space-y-1 text-sm">
        <span className="text-xs text-muted-foreground">Tingkat</span>
        <Select
          value={draft.severity}
          onChange={(e) => setDraft({ ...draft, severity: e.target.value })}
          aria-label="Tingkat"
        >
          {TRIAGE_SEVERITIES.map((level) => (
            <option key={level} value={level}>
              {level}
            </option>
          ))}
        </Select>
      </label>

      <label className="block space-y-1 text-sm">
        <span className="text-xs text-muted-foreground">Status</span>
        <Select
          value={draft.status}
          onChange={(e) => setDraft({ ...draft, status: e.target.value })}
          aria-label="Status tindak lanjut"
        >
          {statusOptions.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </Select>
        {!canClose && (
          <span className="block text-xs text-muted-foreground">
            Hanya admin yang bisa menandai selesai atau diabaikan.
          </span>
        )}
      </label>

      <div className="space-y-1 text-sm">
        <span className="text-xs text-muted-foreground">Ditugaskan ke</span>
        {canAssignOthers ? (
          <Select
            value={draft.assignedTo}
            onChange={(e) => setDraft({ ...draft, assignedTo: e.target.value })}
            aria-label="Ditugaskan ke"
          >
            <option value="">Belum ditugaskan</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </Select>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-xs text-navy">
              {draft.assignedTo === currentUserId ? 'Anda' : draft.assignedTo ? 'Orang lain' : 'Belum ditugaskan'}
            </span>
            {draft.assignedTo !== currentUserId && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setDraft({ ...draft, assignedTo: currentUserId })}
              >
                Ambil sendiri
              </Button>
            )}
          </div>
        )}
      </div>

      <label className="block space-y-1 text-sm">
        <span className="text-xs text-muted-foreground">Catatan</span>
        <Textarea
          value={draft.note}
          onChange={(e) => setDraft({ ...draft, note: e.target.value })}
          rows={3}
          aria-label="Catatan tindak lanjut"
        />
      </label>

      {/* Filled in by hand, never guessed: the system has no way to know which knowledge row an
          operator wrote in response to this particular decision. */}
      <div className="flex gap-2">
        <label className="block flex-1 space-y-1 text-sm">
          <span className="text-xs text-muted-foreground">Perbaikan terkait (jenis)</span>
          <Select
            value={draft.linkedEntityType}
            onChange={(e) => setDraft({ ...draft, linkedEntityType: e.target.value })}
            aria-label="Jenis perbaikan terkait"
          >
            <option value="">—</option>
            <option value="KNOWLEDGE">KNOWLEDGE</option>
            <option value="RULE">RULE</option>
            <option value="FLOW">FLOW</option>
            <option value="TEST_CASE">TEST_CASE</option>
          </Select>
        </label>
        <label className="block flex-1 space-y-1 text-sm">
          <span className="text-xs text-muted-foreground">ID perbaikan</span>
          <Input
            value={draft.linkedEntityId}
            onChange={(e) => setDraft({ ...draft, linkedEntityId: e.target.value })}
            aria-label="ID perbaikan terkait"
          />
        </label>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex items-center gap-2">
        <Button type="button" onClick={() => onSave(draft)} disabled={saving}>
          {saving ? 'Menyimpan...' : 'Simpan tindak lanjut'}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          Batal
        </Button>
      </div>
    </Modal>
  )
}

/** The compact badge the decision list shows per row. */
export function TriageBadge({ triage }: { triage: TriageRow | null }) {
  if (!triage) return <span className="text-xs text-muted-foreground">—</span>
  return (
    <span className="flex flex-col items-start gap-0.5">
      <Badge variant={TRIAGE_STATUS_VARIANT[triage.status] ?? 'muted'}>{triage.status}</Badge>
      {triage.issueType && (
        <span className="text-xs text-muted-foreground">{TRIAGE_ISSUE_LABEL[triage.issueType] ?? triage.issueType}</span>
      )}
    </span>
  )
}
