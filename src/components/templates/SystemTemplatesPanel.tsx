'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Server } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Field, FieldError } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { fetchJson, FetchJsonError } from '@/lib/fetch-json'
import { renderSystemTemplate, validateTemplateBody } from '@/lib/system-templates/render'
import type { SystemTemplateVariable } from '@/lib/system-templates/types'

/**
 * Editor for the messages other programs (javavolcano-touroperator, new-backoffice) send through
 * POST /api/v1/system-messages. Edit → save → live: the next send uses the saved text.
 *
 * The key and the set of variable names are fixed here on purpose — they are the contract the
 * calling programs code against (see src/app/api/system-templates/[key]/route.ts).
 */
type SystemTemplate = {
  id: string
  key: string
  name: string
  description: string | null
  audience: 'CUSTOMER' | 'INTERNAL'
  body: string
  imageUrl: string | null
  variables: SystemTemplateVariable[]
  isActive: boolean
  updatedAt: string
}

const AUDIENCE_LABEL: Record<SystemTemplate['audience'], string> = {
  CUSTOMER: 'Ke pelanggan',
  INTERNAL: 'Internal, crew & hotel',
}

type Draft = { body: string; imageUrl: string; isActive: boolean }

const draftOf = (t: SystemTemplate): Draft => ({ body: t.body, imageUrl: t.imageUrl ?? '', isActive: t.isActive })

export function SystemTemplatesPanel() {
  const [templates, setTemplates] = useState<SystemTemplate[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    fetchJson<{ items: SystemTemplate[] }>('/api/system-templates')
      .then(({ items }) => {
        setTemplates(items)
        if (items[0]) {
          setSelectedKey(items[0].key)
          setDraft(draftOf(items[0]))
        }
      })
      .catch((error: unknown) => {
        setLoadError(error instanceof FetchJsonError ? error.message : 'Gagal memuat template sistem')
      })
  }, [])

  const selected = templates?.find((t) => t.key === selectedKey) ?? null

  const problems = useMemo(
    () => (selected && draft ? validateTemplateBody(draft.body, selected.variables) : []),
    [selected, draft]
  )

  const preview = useMemo(() => {
    if (!selected || !draft) return null
    const values = Object.fromEntries(selected.variables.map((v) => [v.name, v.example ?? `{${v.name}}`]))
    return renderSystemTemplate({ body: draft.body, variables: selected.variables }, values)
  }, [selected, draft])

  const dirty =
    selected !== null &&
    draft !== null &&
    (draft.body !== selected.body || draft.imageUrl !== (selected.imageUrl ?? '') || draft.isActive !== selected.isActive)

  function select(template: SystemTemplate) {
    setSelectedKey(template.key)
    setDraft(draftOf(template))
    setSaveError(null)
    setSavedAt(null)
  }

  function insertVariable(name: string) {
    if (!draft) return
    const token = `{${name}}`
    const el = bodyRef.current
    const start = el?.selectionStart ?? draft.body.length
    const end = el?.selectionEnd ?? draft.body.length
    setDraft({ ...draft, body: draft.body.slice(0, start) + token + draft.body.slice(end) })
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(start + token.length, start + token.length)
    })
  }

  async function save() {
    if (!selected || !draft) return
    setSaving(true)
    setSaveError(null)
    try {
      const updated = await fetchJson<SystemTemplate>(`/api/system-templates/${encodeURIComponent(selected.key)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          body: draft.body,
          imageUrl: draft.imageUrl.trim() === '' ? null : draft.imageUrl.trim(),
          isActive: draft.isActive,
        }),
      })
      setTemplates((current) => current?.map((t) => (t.key === updated.key ? updated : t)) ?? null)
      setDraft(draftOf(updated))
      setSavedAt(new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }))
    } catch (error: unknown) {
      setSaveError(error instanceof FetchJsonError ? error.message : 'Gagal menyimpan')
    } finally {
      setSaving(false)
    }
  }

  if (loadError) return <FieldError>{loadError}</FieldError>

  if (templates === null) {
    return (
      <div role="status" aria-label="Memuat template sistem" className="space-y-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    )
  }

  if (templates.length === 0) {
    return (
      <EmptyState
        icon={<Server />}
        title="Belum ada template sistem"
        description="Template dibuat oleh scripts/seed-system-templates.ts saat deploy."
      />
    )
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[18rem_minmax(0,1fr)_320px] lg:items-start">
      <nav aria-label="Daftar template sistem" className="space-y-4">
        {(['CUSTOMER', 'INTERNAL'] as const).map((audience) => (
          <section key={audience} className="space-y-1">
            <h2 className="px-2 text-xs font-semibold tracking-wide text-ink-subtle uppercase">{AUDIENCE_LABEL[audience]}</h2>
            <ul className="space-y-0.5">
              {templates
                .filter((t) => t.audience === audience)
                .map((t) => (
                  <li key={t.key}>
                    <button
                      type="button"
                      onClick={() => select(t)}
                      aria-current={t.key === selectedKey ? 'true' : undefined}
                      className={cn(
                        'focus-ring flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm',
                        t.key === selectedKey ? 'bg-surface-sunken text-ink' : 'text-ink-muted hover:bg-surface-sunken hover:text-ink'
                      )}
                    >
                      <span className="truncate">{t.name}</span>
                      {!t.isActive && <Badge variant="muted">Nonaktif</Badge>}
                    </button>
                  </li>
                ))}
            </ul>
          </section>
        ))}
      </nav>

      {selected && draft && (
        <Card>
          <CardHeader>
            <CardTitle className="min-w-0">
              <span className="block truncate">{selected.name}</span>
              <code className="block truncate text-xs font-normal text-ink-subtle">{selected.key}</code>
            </CardTitle>
            <label className="flex shrink-0 items-center gap-1.5 text-sm text-ink">
              <input
                type="checkbox"
                checked={draft.isActive}
                onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })}
              />
              Aktif
            </label>
          </CardHeader>
          <CardBody className="space-y-4">
            {selected.description && <p className="text-sm text-ink-muted">{selected.description}</p>}

            <Field
              label="Teks pesan"
              htmlFor="system-template-body"
              error={problems.length > 0 ? problems.join(' ') : undefined}
              hint="Baris yang berisi variabel opsional yang kosong akan dihapus otomatis saat dikirim."
            >
              <Textarea
                id="system-template-body"
                ref={bodyRef}
                rows={14}
                value={draft.body}
                onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                aria-invalid={problems.length > 0}
                className="font-mono text-sm"
              />
            </Field>

            <div className="space-y-1.5">
              <p className="text-sm font-medium text-ink">Variabel dari program pemanggil</p>
              <ul className="flex flex-wrap gap-1.5">
                {selected.variables.map((v) => (
                  <li key={v.name}>
                    <button
                      type="button"
                      onClick={() => insertVariable(v.name)}
                      title={[v.description, v.example ? `Contoh: ${v.example}` : null].filter(Boolean).join(' — ')}
                      className="focus-ring inline-flex items-center gap-1 rounded-sm border border-line px-1.5 py-0.5 font-mono text-xs text-ink hover:bg-surface-sunken"
                    >
                      {`{${v.name}}`}
                      {v.required ? <span className="text-danger">*</span> : <span className="text-ink-subtle">opsional</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            <Field
              label="URL gambar"
              htmlFor="system-template-image"
              hint="Kosongkan untuk mengirim teks saja. Kalau diisi, teks di atas menjadi caption gambar."
            >
              <Input
                id="system-template-image"
                value={draft.imageUrl}
                onChange={(e) => setDraft({ ...draft, imageUrl: e.target.value })}
                placeholder="https://..."
              />
            </Field>

            {saveError && <FieldError>{saveError}</FieldError>}
            <div className="flex items-center justify-end gap-3">
              {savedAt && !dirty && <span className="text-sm text-ink-muted">Tersimpan {savedAt} — langsung berlaku.</span>}
              <Button type="button" variant="outline" disabled={!dirty || saving} onClick={() => setDraft(draftOf(selected))}>
                Batal
              </Button>
              <Button type="button" disabled={!dirty || saving || problems.length > 0} onClick={save}>
                {saving ? 'Menyimpan...' : 'Simpan'}
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      {preview && (
        <div className="space-y-2 lg:sticky lg:top-4" data-testid="system-template-preview">
          <h2 className="text-sm font-semibold text-ink">Preview (nilai contoh)</h2>
          <div className="space-y-2 rounded-lg border border-line bg-surface-sunken p-3">
            {draft?.imageUrl.trim() && (
              // eslint-disable-next-line @next/next/no-img-element -- arbitrary external URL, preview only
              <img src={draft.imageUrl.trim()} alt="" className="max-h-48 w-full rounded-md object-cover" />
            )}
            <p className="text-sm break-words whitespace-pre-wrap text-ink">
              {preview.ok ? preview.text : `Variabel wajib tanpa contoh: ${preview.missing.join(', ')}`}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
