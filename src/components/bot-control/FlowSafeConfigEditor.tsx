'use client'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Modal } from '@/components/ui/modal'
import {
  MAX_CLARIFICATION_ATTEMPTS,
  MIN_CLARIFICATION_ATTEMPTS,
  type FlowSafeConfig,
  type SafeConfigField,
} from '@/lib/bot-control/flow-config'

/** SDD Manage Second §8.3: a change with no stated reason answers nothing later. */
const MIN_REASON_LENGTH = 10

const FIELD_LABEL: Record<SafeConfigField, string> = {
  greetingText: 'Sapaan pembuka',
  clarificationPrompt: 'Kalimat minta penjelasan',
  maxClarificationAttempts: 'Maksimal minta penjelasan',
  fallbackReply: 'Balasan saat bot tidak tahu',
  handoffReply: 'Balasan saat dialihkan ke agent',
  workingHoursReply: 'Balasan di luar jam kerja',
  leadFields: 'Data yang wajib ditanyakan',
}

const FIELD_HINT: Partial<Record<SafeConfigField, string>> = {
  maxClarificationAttempts: `Antara ${MIN_CLARIFICATION_ATTEMPTS} dan ${MAX_CLARIFICATION_ATTEMPTS}. Bot menyerah dan mengalihkan ke agent setelah ini.`,
  leadFields: 'Dipisah koma. Tiap field adalah satu pertanyaan lagi sebelum customer dapat jawabannya.',
}

const LONG_TEXT_FIELDS: readonly SafeConfigField[] = [
  'greetingText',
  'clarificationPrompt',
  'fallbackReply',
  'handoffReply',
  'workingHoursReply',
]

/**
 * The flow safe-config form.
 *
 * Renders only the fields the SERVER said this flow's `editableLevel` permits — never the full
 * list filtered client-side. A field the runtime will not honour must not appear at all: an
 * operator who fills in a box that does nothing believes they changed the bot's behaviour, and
 * that belief is more damaging than the missing control.
 *
 * Every text box may be left empty, and the copy says what that means. Empty is "keep the
 * wording that is in the code", not "say nothing" — without that, reverting a bad edit would
 * mean retyping the original sentence from memory.
 */
export function FlowSafeConfigEditor({
  flowName,
  fields,
  initial,
  saving,
  error,
  onCancel,
  onSave,
}: {
  flowName: string
  fields: readonly SafeConfigField[]
  initial: FlowSafeConfig
  saving: boolean
  error: string | null
  onCancel: () => void
  onSave: (config: FlowSafeConfig, reason: string) => void
}) {
  const [config, setConfig] = useState<FlowSafeConfig>(initial)
  const [reason, setReason] = useState('')

  function setText(field: SafeConfigField, value: string) {
    setConfig((prev) => ({ ...prev, [field]: value }))
  }

  return (
    <Modal onClose={onCancel} className="max-h-[85vh] w-full max-w-2xl space-y-3 overflow-y-auto p-4">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold text-navy">Konfigurasi aman &mdash; {flowName}</h2>
        <p className="text-xs text-muted-foreground">
          Hanya teks dan ambang yang dibaca kode apa adanya. Percabangan flow tetap read-only sampai Flow Builder V1.
        </p>
        <p className="text-xs text-muted-foreground">
          Kosongkan sebuah kolom untuk kembali memakai kalimat bawaan dari kode. Perubahan baru berlaku setelah
          dipublish lewat Releases.
        </p>
      </div>

      {fields.length === 0 && (
        <p className="text-sm text-muted-foreground">Flow ini tidak punya konfigurasi yang bisa diubah dari UI.</p>
      )}

      {fields.map((field) => (
        <label key={field} className="block space-y-1 text-sm">
          <span className="text-xs text-muted-foreground">{FIELD_LABEL[field]}</span>

          {LONG_TEXT_FIELDS.includes(field) && (
            <Textarea
              value={typeof config[field] === 'string' ? (config[field] as string) : ''}
              onChange={(e) => setText(field, e.target.value)}
              aria-label={FIELD_LABEL[field]}
              rows={2}
            />
          )}

          {field === 'maxClarificationAttempts' && (
            <Input
              type="number"
              min={MIN_CLARIFICATION_ATTEMPTS}
              max={MAX_CLARIFICATION_ATTEMPTS}
              value={config.maxClarificationAttempts === undefined ? '' : String(config.maxClarificationAttempts)}
              onChange={(e) =>
                setConfig((prev) => ({
                  ...prev,
                  // Empty clears the override rather than sending 0, which the schema rejects
                  // and which would mean "never clarify" — a behaviour change dressed as a typo.
                  maxClarificationAttempts: e.target.value === '' ? undefined : Number(e.target.value),
                }))
              }
              aria-label={FIELD_LABEL[field]}
              className="w-32"
            />
          )}

          {field === 'leadFields' && (
            <Input
              value={(config.leadFields ?? []).join(', ')}
              onChange={(e) => {
                const parsed = e.target.value
                  .split(',')
                  .map((item) => item.trim())
                  .filter(Boolean)
                setConfig((prev) => ({ ...prev, leadFields: parsed.length > 0 ? parsed : undefined }))
              }}
              aria-label={FIELD_LABEL[field]}
            />
          )}

          {FIELD_HINT[field] && <span className="block text-xs text-muted-foreground">{FIELD_HINT[field]}</span>}
        </label>
      ))}

      <Textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Alasan perubahan, minimal 10 karakter"
        aria-label="Alasan perubahan"
        rows={2}
      />
      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex items-center gap-2">
        <Button
          type="button"
          onClick={() => onSave(stripEmpty(config, fields), reason.trim())}
          disabled={saving || fields.length === 0 || reason.trim().length < MIN_REASON_LENGTH}
        >
          {saving ? 'Menyimpan...' : 'Simpan draft'}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          Batal
        </Button>
      </div>
    </Modal>
  )
}

/**
 * Drops empty values and anything outside the permitted field list before sending.
 *
 * Both halves matter. An empty string would be stored as an override that says nothing, and a
 * field the level does not permit would be rejected by the API — turning a form the operator
 * filled in correctly into an error they cannot act on.
 */
function stripEmpty(config: FlowSafeConfig, fields: readonly SafeConfigField[]): FlowSafeConfig {
  const out: Record<string, unknown> = {}
  for (const field of fields) {
    const value = config[field]
    if (value === undefined || value === null) continue
    if (typeof value === 'string' && value.trim().length === 0) continue
    if (Array.isArray(value) && value.length === 0) continue
    out[field] = typeof value === 'string' ? value.trim() : value
  }
  return out as FlowSafeConfig
}
