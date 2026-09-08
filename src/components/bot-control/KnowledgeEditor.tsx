'use client'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Modal } from '@/components/ui/modal'
import type { KnowledgeItem } from '@/lib/bot-control/knowledge-body'

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
}: {
  initial: KnowledgeDraft
  title: string
  saving: boolean
  error: string | null
  onCancel: () => void
  /** `activate` distinguishes "Simpan draft" from "Simpan & aktifkan". */
  onSave: (draft: KnowledgeDraft, reason: string, activate: boolean) => void
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
      <div className="space-y-1">
        <h2 className="text-sm font-semibold text-navy">{title}</h2>
        <p className="text-xs text-muted-foreground">
          Disimpan sebagai draft, bot belum membacanya. Tekan &ldquo;Simpan &amp; aktifkan&rdquo; kalau isinya sudah
          boleh dipakai menjawab customer.
        </p>
      </div>

      <label className="block space-y-1 text-sm">
        <span className="text-xs text-muted-foreground">Judul</span>
        <Input
          value={draft.title}
          onChange={(e) => setDraft((prev) => ({ ...prev, title: e.target.value }))}
          aria-label="Judul knowledge"
        />
      </label>

      <label className="block space-y-1 text-sm">
        <span className="text-xs text-muted-foreground">Ringkasan (opsional)</span>
        <Input
          value={draft.summary}
          onChange={(e) => setDraft((prev) => ({ ...prev, summary: e.target.value }))}
          aria-label="Ringkasan knowledge"
        />
      </label>

      <div className="space-y-3">
        {draft.items.map((item, index) => (
          <div key={index} className="space-y-2 rounded border p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Item {index + 1}</span>
              {draft.items.length > 1 && (
                <Button type="button" variant="outline" size="sm" onClick={() => removeItem(index)}>
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
          variant="outline"
          onClick={() => onSave(draft, reason.trim(), false)}
          disabled={saving || !complete || reason.trim().length < MIN_REASON_LENGTH}
        >
          {saving ? 'Menyimpan...' : 'Simpan draft'}
        </Button>
        <Button
          type="button"
          onClick={() => onSave(draft, reason.trim(), true)}
          disabled={saving || !complete || reason.trim().length < MIN_REASON_LENGTH}
        >
          {saving ? 'Menyimpan...' : 'Simpan & aktifkan'}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          Batal
        </Button>
      </div>
    </Modal>
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
    <div className="space-y-1">
      <span className="text-xs text-muted-foreground">Harga yang boleh dikutip bot</span>
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
          <Button type="button" variant="outline" size="sm" onClick={() => onChange(prices.filter((_, j) => j !== i))}>
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
    <div className="space-y-1">
      <span className="text-xs text-muted-foreground">Tautan yang boleh dikirim bot</span>
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
          <Button type="button" variant="outline" size="sm" onClick={() => onChange(links.filter((_, j) => j !== i))}>
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
