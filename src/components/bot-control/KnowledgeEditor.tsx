'use client'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Field, FieldError, Label } from '@/components/ui/label'
import { Modal } from '@/components/ui/modal'
import type { KnowledgeItem } from '@/lib/bot-control/knowledge-body'
// `module-resolver.ts` has no imports of its own, so pulling RESOLVER_TOPICS into a client
// component costs nothing extra in the bundle.
import { RESOLVER_TOPICS } from '@/lib/bot/module-resolver'

export type KnowledgeDraft = {
  title: string
  summary: string
  items: KnowledgeItem[]
}

/** SDD Manage Second §8.2: a change with no stated reason answers nothing later. */
const MIN_REASON_LENGTH = 10

const EMPTY_ITEM: KnowledgeItem = { question: '', answer: '' }

/**
 * The managed-knowledge editor: question/answer pairs, with the structured extras the bot
 * needs in order to be allowed to quote them.
 *
 * Prices and links are separate fields rather than something an operator writes into the
 * answer prose, because `bot.no_invented_price` and `bot.no_invented_url` are CRITICAL rules:
 * the bot may only state a price or URL it can SOURCE. A figure buried in a sentence is
 * indistinguishable, to the verifier, from one the model made up.
 *
 * Two buttons, because there are two things an operator means. "Simpan draft" writes the text
 * down without changing what the bot says — the half-finished answer, the price waiting on a
 * confirmation. "Simpan & aktifkan" does the same write and then turns it on, which is what
 * somebody fixing a wrong answer at 9pm actually wants. There is no third state in between,
 * and no release to remember afterwards.
 */
export function KnowledgeEditor({
  initial,
  title,
  saving,
  error,
  onCancel,
  onSave,
  activateOnly = false,
}: {
  initial: KnowledgeDraft
  title: string
  saving: boolean
  error: string | null
  onCancel: () => void
  /** `activate` distinguishes "Simpan draft" from "Simpan & aktifkan". */
  onSave: (draft: KnowledgeDraft, reason: string, activate: boolean) => void
  /** Hanya "Simpan & aktifkan" (panel perbaikan di Inbox). Tanpa prop ini perilaku tidak berubah. */
  activateOnly?: boolean
}) {
  const [draft, setDraft] = useState<KnowledgeDraft>({
    ...initial,
    // Never open on an empty list: a form with no fields gives an operator nothing to start
    // from and reads as broken.
    items: initial.items.length > 0 ? initial.items : [EMPTY_ITEM],
  })
  const [reason, setReason] = useState('')

  function updateItem(index: number, patch: Partial<KnowledgeItem>) {
    setDraft((prev) => ({
      ...prev,
      items: prev.items.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    }))
  }

  function removeItem(index: number) {
    setDraft((prev) => ({
      ...prev,
      // Never below one. An empty body is rejected by the API anyway; letting the form reach
      // that state just turns a save into an error the operator has to decode.
      items: prev.items.length <= 1 ? prev.items : prev.items.filter((_, i) => i !== index),
    }))
  }

  const complete =
    draft.title.trim().length > 0 &&
    draft.items.every((item) => item.question.trim().length > 0 && item.answer.trim().length > 0)

  return (
    <Modal onClose={onCancel} className="max-h-[85vh] w-full max-w-2xl space-y-3 overflow-y-auto p-4">
      <div className="space-y-1 border-b border-line pb-3">
        <h2 className="text-base font-semibold text-ink">{title}</h2>
        {activateOnly ? (
          <p className="text-sm text-ink-muted">Tersimpan langsung aktif: bot memakainya mulai pesan berikutnya.</p>
        ) : (
          <p className="text-sm text-ink-muted">
            Disimpan sebagai draft, bot belum membacanya. Tekan &ldquo;Simpan &amp; aktifkan&rdquo; kalau isinya sudah
            boleh dipakai menjawab customer.
          </p>
        )}
      </div>

      <Field label="Judul">
        <Input
          value={draft.title}
          onChange={(e) => setDraft((prev) => ({ ...prev, title: e.target.value }))}
          aria-label="Judul knowledge"
        />
      </Field>

      <Field label="Ringkasan (opsional)">
        <Input
          value={draft.summary}
          onChange={(e) => setDraft((prev) => ({ ...prev, summary: e.target.value }))}
          aria-label="Ringkasan knowledge"
        />
      </Field>

      <div className="space-y-3">
        {draft.items.map((item, index) => (
          <div key={index} className="space-y-2 rounded-md border border-line p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-ink tabular-nums">Item {index + 1}</span>
              {draft.items.length > 1 && (
                <Button type="button" variant="ghost" size="sm" onClick={() => removeItem(index)}>
                  Hapus item
                </Button>
              )}
            </div>

            <Input
              value={item.question}
              onChange={(e) => updateItem(index, { question: e.target.value })}
              placeholder="Pertanyaan customer"
              aria-label={`Pertanyaan item ${index + 1}`}
            />
            <Textarea
              value={item.answer}
              onChange={(e) => updateItem(index, { answer: e.target.value })}
              placeholder="Jawaban yang boleh dipakai bot"
              aria-label={`Jawaban item ${index + 1}`}
              rows={3}
            />
            <Input
              value={(item.tags ?? []).join(', ')}
              onChange={(e) =>
                updateItem(index, {
                  tags: e.target.value
                    .split(',')
                    .map((tag) => tag.trim())
                    .filter(Boolean),
                })
              }
              placeholder="Tag, dipisah koma (mis. atv, harga)"
              aria-label={`Tag item ${index + 1}`}
            />

            <TopicFields
              topics={item.topics ?? []}
              onChange={(topics) => updateItem(index, { topics: topics.length > 0 ? topics : undefined })}
              index={index}
            />

            <PriceFields
              prices={item.prices ?? []}
              onChange={(prices) => updateItem(index, { prices: prices.length > 0 ? prices : undefined })}
              index={index}
            />
            <LinkFields
              links={item.links ?? []}
              onChange={(links) => updateItem(index, { links: links.length > 0 ? links : undefined })}
              index={index}
            />
          </div>
        ))}

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setDraft((prev) => ({ ...prev, items: [...prev.items, { ...EMPTY_ITEM }] }))}
        >
          Tambah item
        </Button>
      </div>

      <Field label="Alasan perubahan" hint="Minimal 10 karakter — inilah yang menjelaskan revisi ini berbulan-bulan kemudian.">
        <Textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Alasan perubahan, minimal 10 karakter"
          aria-label="Alasan perubahan"
          rows={2}
        />
      </Field>
      {error && <FieldError>{error}</FieldError>}

      {/* Satu aksi utama, dan ia yang berwarna aksen: menyimpan lalu mengaktifkan adalah yang
          dimaksud orang yang sedang memperbaiki jawaban salah jam sembilan malam. */}
      <div className="flex items-center gap-2 border-t border-line pt-3">
        <Button
          type="button"
          onClick={() => onSave(draft, reason.trim(), true)}
          disabled={saving || !complete || reason.trim().length < MIN_REASON_LENGTH}
        >
          {saving ? 'Menyimpan...' : 'Simpan & aktifkan'}
        </Button>
        {!activateOnly && (
          <Button
            type="button"
            variant="outline"
            onClick={() => onSave(draft, reason.trim(), false)}
            disabled={saving || !complete || reason.trim().length < MIN_REASON_LENGTH}
          >
            {saving ? 'Menyimpan...' : 'Simpan draft'}
          </Button>
        )}
        <Button type="button" variant="ghost" className="ml-auto" onClick={onCancel}>
          Batal
        </Button>
      </div>
    </Modal>
  )
}

/**
 * Which of the 14 topics this item answers — the gate `runtime-integration.ts` checks before
 * letting a fact reach a reply. Task 8's classifier can misfire; this is how an operator catches
 * that without opening the trace. The visible label is the raw topic id, matching what shows up
 * in the trace, on purpose — translating it would make the two impossible to compare.
 *
 * Unchecking every box sends `topics: undefined`, the same "empty means absent" pattern
 * `prices`/`links` already use in this file.
 */
function TopicFields({
  topics,
  onChange,
  index,
}: {
  topics: NonNullable<KnowledgeItem['topics']>
  onChange: (topics: NonNullable<KnowledgeItem['topics']>) => void
  index: number
}) {
  return (
    <div className="space-y-1.5">
      <Label>Topik yang dilayani fakta ini</Label>
      <div className="flex flex-wrap gap-x-3 gap-y-1.5">
        {RESOLVER_TOPICS.map((topic) => (
          <label key={topic} className="flex items-center gap-1.5 text-sm text-ink">
            <input
              type="checkbox"
              checked={topics.includes(topic)}
              onChange={(e) =>
                onChange(e.target.checked ? [...topics, topic] : topics.filter((t) => t !== topic))
              }
              aria-label={`Topik ${topic} item ${index + 1}`}
              className="focus-ring size-3.5 shrink-0 rounded-xs"
            />
            {topic}
          </label>
        ))}
      </div>
      {/* Ruling R88: mengosongkan semua centang mengirim `topics: undefined` (lihat header
          komponen ini), lalu classifyFactTopics (Task 8) mengisinya lagi saat disimpan -- tanpa
          kalimat ini operator tidak tahu kotak kosong tidak berarti "tanpa topik selamanya". */}
      <p className="text-xs text-ink-muted">Kosongkan semua = topik diisi otomatis saat disimpan.</p>
    </div>
  )
}

function PriceFields({
  prices,
  onChange,
  index,
}: {
  prices: NonNullable<KnowledgeItem['prices']>
  onChange: (prices: NonNullable<KnowledgeItem['prices']>) => void
  index: number
}) {
  return (
    <div className="space-y-1.5">
      <Label>Harga yang boleh dikutip bot</Label>
      {prices.map((price, i) => (
        <div key={i} className="flex flex-wrap gap-1">
          <Input
            value={price.label}
            onChange={(e) => onChange(prices.map((p, j) => (j === i ? { ...p, label: e.target.value } : p)))}
            placeholder="Label"
            aria-label={`Label harga ${i + 1} item ${index + 1}`}
            className="w-40"
          />
          <Input
            type="number"
            value={String(price.amount)}
            onChange={(e) =>
              onChange(prices.map((p, j) => (j === i ? { ...p, amount: Number(e.target.value) } : p)))
            }
            placeholder="Nominal"
            aria-label={`Nominal harga ${i + 1} item ${index + 1}`}
            className="w-32"
          />
          {/* Currency is required, not defaulted: a number with an assumed currency is exactly
              the kind of figure this system must not let the bot state. */}
          <Input
            value={price.currency}
            onChange={(e) => onChange(prices.map((p, j) => (j === i ? { ...p, currency: e.target.value } : p)))}
            placeholder="IDR"
            aria-label={`Mata uang harga ${i + 1} item ${index + 1}`}
            className="w-20"
          />
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(prices.filter((_, j) => j !== i))}>
            Hapus
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onChange([...prices, { label: '', amount: 0, currency: 'IDR' }])}
      >
        Tambah harga
      </Button>
    </div>
  )
}

function LinkFields({
  links,
  onChange,
  index,
}: {
  links: NonNullable<KnowledgeItem['links']>
  onChange: (links: NonNullable<KnowledgeItem['links']>) => void
  index: number
}) {
  return (
    <div className="space-y-1.5">
      <Label>Tautan yang boleh dikirim bot</Label>
      {links.map((link, i) => (
        <div key={i} className="flex flex-wrap gap-1">
          <Input
            value={link.label}
            onChange={(e) => onChange(links.map((l, j) => (j === i ? { ...l, label: e.target.value } : l)))}
            placeholder="Label"
            aria-label={`Label tautan ${i + 1} item ${index + 1}`}
            className="w-40"
          />
          <Input
            value={link.url}
            onChange={(e) => onChange(links.map((l, j) => (j === i ? { ...l, url: e.target.value } : l)))}
            placeholder="https://..."
            aria-label={`URL tautan ${i + 1} item ${index + 1}`}
            className="w-64"
          />
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(links.filter((_, j) => j !== i))}>
            Hapus
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={() => onChange([...links, { label: '', url: '' }])}>
        Tambah tautan
      </Button>
    </div>
  )
}
