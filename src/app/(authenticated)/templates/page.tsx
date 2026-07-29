'use client'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Select } from '@/components/ui/select'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { fetchJson } from '@/lib/fetch-json'
import { VARIABLE_FIELD_DEFS } from '@/lib/booking/variable-fields'
import type { TemplateSuggestion } from '@/lib/bot/template-suggester'

type TemplateType = 'OFFICIAL' | 'QUICK_REPLY'
type TemplateFormat = 'TEXT' | 'CAROUSEL' | 'LTO' | 'COUPON'
type MetaStatus = 'APPROVED' | 'PENDING' | 'REJECTED' | 'NOT_APPLICABLE'
type ButtonType = 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER'

type CardButton = { type: ButtonType; text: string; url?: string; phoneNumber?: string }
type TemplateCard = { mediaType: 'IMAGE' | 'VIDEO'; mediaUrl: string; bodyText: string; buttons: CardButton[] }

type Template = {
  id: string
  name: string
  type: TemplateType
  format: TemplateFormat
  metaStatus: MetaStatus
  category: string | null
  body: string
  variables: string[] | null
  variableBindings: Record<string, string> | null
  cards: TemplateCard[] | null
  offerTitle: string | null
  buttons: CardButton[] | null
  couponButtonText: string | null
  couponExampleCode: string | null
  createdAt: string
}

// Draft shape for the card builder -- every field is a plain string (even the button type
// selects) so every input stays a controlled component; only converted to the real
// CardButton/TemplateCard union on submit.
type ButtonDraft = { type: ButtonType; text: string; url: string; phoneNumber: string }
type CardDraft = { mediaType: 'IMAGE' | 'VIDEO'; mediaUrl: string; bodyText: string; buttons: ButtonDraft[] }

const EMPTY_CARD: CardDraft = { mediaType: 'IMAGE', mediaUrl: '', bodyText: '', buttons: [] }
const MAX_CARDS = 10
const MAX_BUTTONS_PER_CARD = 2

const metaStatusVariant: Record<MetaStatus, 'success' | 'warning' | 'destructive' | 'muted'> = {
  APPROVED: 'success',
  PENDING: 'warning',
  REJECTED: 'destructive',
  NOT_APPLICABLE: 'muted',
}

const metaStatusLabel: Record<MetaStatus, string> = {
  APPROVED: 'Disetujui',
  PENDING: 'Menunggu',
  REJECTED: 'Ditolak',
  NOT_APPLICABLE: 'Tidak berlaku',
}

function cardDraftIsValid(card: CardDraft): boolean {
  return card.mediaUrl.trim() !== '' && card.bodyText.trim() !== '' && card.buttons.every(buttonDraftIsValid)
}

function toCardPayload(card: CardDraft): TemplateCard {
  return {
    mediaType: card.mediaType,
    mediaUrl: card.mediaUrl.trim(),
    bodyText: card.bodyText.trim(),
    buttons: card.buttons.map(toButtonPayload),
  }
}

function toButtonPayload(b: ButtonDraft): CardButton {
  if (b.type === 'URL') return { type: 'URL', text: b.text.trim(), url: b.url.trim() }
  if (b.type === 'PHONE_NUMBER') return { type: 'PHONE_NUMBER', text: b.text.trim(), phoneNumber: b.phoneNumber.trim() }
  return { type: 'QUICK_REPLY', text: b.text.trim() }
}

function buttonDraftIsValid(b: ButtonDraft): boolean {
  if (!b.text.trim()) return false
  if (b.type === 'URL') return b.url.trim() !== ''
  if (b.type === 'PHONE_NUMBER') return b.phoneNumber.trim() !== ''
  return true
}

const EMPTY_BUTTON: ButtonDraft = { type: 'QUICK_REPLY', text: '', url: '', phoneNumber: '' }
const MAX_LTO_BUTTONS = 3

export default function TemplatesPage() {
  const [tab, setTab] = useState<TemplateType>('OFFICIAL')
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const [name, setName] = useState('')
  const [category, setCategory] = useState('')
  const [body, setBody] = useState('')
  const [variableNames, setVariableNames] = useState<string[]>([])
  const [format, setFormat] = useState<TemplateFormat>('TEXT')
  const [cards, setCards] = useState<CardDraft[]>([EMPTY_CARD])
  const [offerTitle, setOfferTitle] = useState('')
  const [ltoButtons, setLtoButtons] = useState<ButtonDraft[]>([])
  const [couponButtonText, setCouponButtonText] = useState('')
  const [couponExampleCode, setCouponExampleCode] = useState('')
  // Maps a variable's 1-indexed position (as a string key) to a variable-fields.ts field key --
  // chosen once here, resolved automatically against each conversation's own data at send time
  // (see ComposeBox). A position absent from this map is unbound: the agent fills it manually.
  const [variableBindings, setVariableBindings] = useState<Record<string, string>>({})
  // AI-drafted new template suggestions, mined from real inbound messages across every
  // conversation (not one chat) -- see openSuggestions below and
  // src/lib/bot/template-suggester.ts. Purely a drafting aid: nothing is saved until the
  // admin selects one or more and confirms.
  const [suggestOpen, setSuggestOpen] = useState(false)
  const [suggestions, setSuggestions] = useState<TemplateSuggestion[]>([])
  const [suggestLoading, setSuggestLoading] = useState(false)
  const [suggestError, setSuggestError] = useState<string | null>(null)
  const [selectedSuggestions, setSelectedSuggestions] = useState<Set<number>>(new Set())
  const [savingSuggestions, setSavingSuggestions] = useState(false)

  useEffect(() => {
    fetchJson<Template[]>('/api/templates')
      .then(setTemplates)
      .catch(() => setError('Gagal memuat template'))
      .finally(() => setLoading(false))
  }, [])

  function resetForm() {
    setName('')
    setCategory('')
    setBody('')
    setVariableNames([])
    setFormat('TEXT')
    setCards([EMPTY_CARD])
    setOfferTitle('')
    setLtoButtons([])
    setCouponButtonText('')
    setCouponExampleCode('')
    setVariableBindings({})
  }

  function updateCard(index: number, patch: Partial<CardDraft>) {
    setCards((prev) => prev.map((c, i) => (i === index ? { ...c, ...patch } : c)))
  }

  function addCard() {
    setCards((prev) => (prev.length >= MAX_CARDS ? prev : [...prev, EMPTY_CARD]))
  }

  function removeCard(index: number) {
    setCards((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)))
  }

  function addButton(cardIndex: number) {
    setCards((prev) =>
      prev.map((c, i) =>
        i === cardIndex && c.buttons.length < MAX_BUTTONS_PER_CARD
          ? { ...c, buttons: [...c.buttons, { type: 'QUICK_REPLY', text: '', url: '', phoneNumber: '' }] }
          : c
      )
    )
  }

  function removeButton(cardIndex: number, buttonIndex: number) {
    setCards((prev) =>
      prev.map((c, i) => (i === cardIndex ? { ...c, buttons: c.buttons.filter((_, bi) => bi !== buttonIndex) } : c))
    )
  }

  function updateButton(cardIndex: number, buttonIndex: number, patch: Partial<ButtonDraft>) {
    setCards((prev) =>
      prev.map((c, i) =>
        i === cardIndex
          ? { ...c, buttons: c.buttons.map((b, bi) => (bi === buttonIndex ? { ...b, ...patch } : b)) }
          : c
      )
    )
  }

  // A single button: no separate "type a name first" step. Clicking it drops the next
  // {{n}} placeholder straight into the body (where an agent would otherwise have to type it
  // by hand, easy to get out of sync with the list below) and adds its row to the variable
  // list in the same action, ready to be named.
  function addVariable() {
    const nextPosition = variableNames.length + 1
    setBody((prev) => {
      const placeholder = `{{${nextPosition}}}`
      if (!prev) return placeholder
      return /\s$/.test(prev) ? prev + placeholder : `${prev} ${placeholder}`
    })
    setVariableNames((prev) => [...prev, ''])
  }

  function updateVariable(index: number, name: string) {
    setVariableNames((prev) => prev.map((v, i) => (i === index ? name : v)))
  }

  function removeVariable(index: number) {
    setVariableNames((prev) => prev.filter((_, i) => i !== index))
  }

  function addLtoButton() {
    setLtoButtons((prev) => (prev.length >= MAX_LTO_BUTTONS ? prev : [...prev, EMPTY_BUTTON]))
  }

  function removeLtoButton(index: number) {
    setLtoButtons((prev) => prev.filter((_, i) => i !== index))
  }

  function updateLtoButton(index: number, patch: Partial<ButtonDraft>) {
    setLtoButtons((prev) => prev.map((b, i) => (i === index ? { ...b, ...patch } : b)))
  }

  const isCarousel = tab === 'OFFICIAL' && format === 'CAROUSEL'
  const isLto = tab === 'OFFICIAL' && format === 'LTO'
  const isCoupon = tab === 'OFFICIAL' && format === 'COUPON'
  const cardsValid = !isCarousel || cards.every(cardDraftIsValid)
  const ltoValid = !isLto || (offerTitle.trim() !== '' && ltoButtons.every(buttonDraftIsValid))
  const couponValid = !isCoupon || (couponButtonText.trim() !== '' && couponExampleCode.trim() !== '')
  const formValid = cardsValid && ltoValid && couponValid

  // Every variable this draft currently has, as {position, label} -- named and positional by
  // index (the "+ Tambah Variabel" list below), the same for OFFICIAL and QUICK_REPLY alike.
  // Feeds the "Sumber Nilai Variabel" binding UI below.
  const namedVariables = variableNames.map((v) => v.trim()).filter(Boolean)
  const variablePositions = namedVariables.map((name, i) => ({ position: i + 1, label: `{{${i + 1}}} ${name}` }))

  // Templates are what actually gets submitted to Meta (or shown as compose-box shortcuts), so
  // the list must only ever reflect what the server confirmed — no optimistic insert. Await the
  // response, and only append to state once the server has created (and, for OFFICIAL, actually
  // submitted to Meta) the row. On failure, surface the server's error instead of guessing.
  async function createTemplate() {
    if (!name.trim() || !body.trim() || !formValid) return
    setError(null)
    setSubmitting(true)
    try {
      const variables = variableNames.map((v) => v.trim()).filter(Boolean)

      // Only positions that (a) are still real on this draft (a variable removed after being
      // bound must not resurrect a stale binding) and (b) actually have a chosen source --
      // "Isi manual" leaves that position out of the map entirely.
      const validPositions = new Set(variablePositions.map((v) => String(v.position)))
      const bindings = Object.fromEntries(
        Object.entries(variableBindings).filter(([position, key]) => key && validPositions.has(position))
      )

      const res = await fetch('/api/templates', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          type: tab,
          category: category.trim() || undefined,
          body: body.trim(),
          ...(Object.keys(bindings).length > 0 ? { variableBindings: bindings } : {}),
          ...(variables.length > 0 ? { variables } : {}),
          ...(isCarousel ? { format: 'CAROUSEL', cards: cards.map(toCardPayload) } : {}),
          ...(isLto ? { format: 'LTO', offerTitle: offerTitle.trim(), buttons: ltoButtons.map(toButtonPayload) } : {}),
          ...(isCoupon
            ? { format: 'COUPON', couponButtonText: couponButtonText.trim(), couponExampleCode: couponExampleCode.trim() }
            : {}),
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setError(data?.error ?? 'Gagal menyimpan template')
        return
      }

      const created = (await res.json()) as Template
      setTemplates((prev) => [created, ...prev])
      resetForm()
    } catch {
      setError('Gagal menyimpan template')
    } finally {
      setSubmitting(false)
    }
  }

  async function openSuggestions() {
    setSuggestError(null)
    setSuggestions([])
    setSelectedSuggestions(new Set())
    setSuggestOpen(true)
    setSuggestLoading(true)
    try {
      const res = await fetch('/api/templates/suggest', { method: 'POST' })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setSuggestError(data?.error ?? 'Gagal membuat rekomendasi')
        return
      }
      const data = (await res.json()) as { suggestions: TemplateSuggestion[] }
      setSuggestions(data.suggestions)
    } catch {
      setSuggestError('Gagal membuat rekomendasi')
    } finally {
      setSuggestLoading(false)
    }
  }

  function toggleSuggestion(index: number) {
    setSelectedSuggestions((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  // Every selected draft is created as a real QUICK_REPLY template via the same POST
  // /api/templates the manual form above uses -- variable names + suggested bindings ride
  // along exactly as chosen at creation time (src/lib/booking/variable-fields.ts keys), no
  // different from an admin having typed them in by hand.
  async function saveSelectedSuggestions() {
    if (selectedSuggestions.size === 0) return
    setSavingSuggestions(true)
    setSuggestError(null)
    try {
      const toSave = suggestions.filter((_, i) => selectedSuggestions.has(i))
      const created: Template[] = []
      for (const s of toSave) {
        const bindings = Object.fromEntries(
          s.variables.map((v, i) => [String(i + 1), v.bindingKey] as const).filter(([, key]) => key)
        )
        const res = await fetch('/api/templates', {
          method: 'POST',
          body: JSON.stringify({
            name: s.name,
            type: 'QUICK_REPLY',
            body: s.body,
            ...(s.variables.length > 0 ? { variables: s.variables.map((v) => v.name) } : {}),
            ...(Object.keys(bindings).length > 0 ? { variableBindings: bindings } : {}),
          }),
        })
        if (res.ok) created.push(await res.json())
      }
      setTemplates((prev) => [...created, ...prev])
      setSuggestOpen(false)
    } catch {
      setSuggestError('Gagal menyimpan template terpilih')
    } finally {
      setSavingSuggestions(false)
    }
  }

  const filtered = templates.filter((t) => t.type === tab)

  return (
    <main className="mx-auto max-w-3xl space-y-4 p-6">
      <h1 className="text-xl font-semibold text-navy">Template Pesan</h1>

      <div className="flex gap-2">
        <Button
          type="button"
          variant={tab === 'OFFICIAL' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setTab('OFFICIAL')}
        >
          Resmi (Meta)
        </Button>
        <Button
          type="button"
          variant={tab === 'QUICK_REPLY' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setTab('QUICK_REPLY')}
        >
          Balasan Cepat
        </Button>
      </div>

      {tab === 'QUICK_REPLY' && (
        <Card className="space-y-3 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-medium text-navy">✨ Rekomendasi Template (AI)</h2>
              <p className="text-xs text-muted-foreground">
                Analisis pertanyaan yang sering masuk dari seluruh chat, lalu usulkan balasan cepat baru.
              </p>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={openSuggestions} disabled={suggestLoading}>
              {suggestLoading ? 'Menganalisis...' : 'Buat Rekomendasi'}
            </Button>
          </div>
          {suggestOpen && (
            <div className="space-y-2 rounded-lg border border-border p-3">
              {suggestLoading && (
                <p className="text-sm text-muted-foreground">Menganalisis pesan masuk dari seluruh chat...</p>
              )}
              {suggestError && <p className="text-xs text-destructive">{suggestError}</p>}
              {!suggestLoading && !suggestError && suggestions.length === 0 && (
                <p className="text-sm text-muted-foreground">Belum ada pola pertanyaan yang cukup jelas untuk direkomendasikan.</p>
              )}
              {!suggestLoading && suggestions.length > 0 && (
                <>
                  <div className="space-y-2">
                    {suggestions.map((s, i) => (
                      <label
                        key={i}
                        className="flex cursor-pointer items-start gap-2 rounded-lg border border-border p-2 hover:bg-muted/50"
                      >
                        <input
                          type="checkbox"
                          checked={selectedSuggestions.has(i)}
                          onChange={() => toggleSuggestion(i)}
                          aria-label={`Pilih rekomendasi ${s.name}`}
                          className="mt-1"
                        />
                        <div className="min-w-0 flex-1 space-y-0.5">
                          <p className="text-sm font-medium text-navy">{s.name}</p>
                          <p className="text-xs text-foreground">{s.body}</p>
                          {s.variables.length > 0 && (
                            <p className="text-[11px] text-muted-foreground">
                              Variabel:{' '}
                              {s.variables
                                .map(
                                  (v) =>
                                    `${v.name} (${
                                      v.bindingKey
                                        ? (VARIABLE_FIELD_DEFS.find((f) => f.key === v.bindingKey)?.label ?? v.bindingKey)
                                        : 'isi manual'
                                    })`
                                )
                                .join(', ')}
                            </p>
                          )}
                          <p className="text-[11px] italic text-muted-foreground">{s.reason}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    onClick={saveSelectedSuggestions}
                    disabled={selectedSuggestions.size === 0 || savingSuggestions}
                  >
                    {savingSuggestions ? 'Menyimpan...' : `Simpan Terpilih (${selectedSuggestions.size})`}
                  </Button>
                </>
              )}
            </div>
          )}
        </Card>
      )}

      <Card className="space-y-3 p-4">
        <h2 className="font-medium text-navy">
          {tab === 'OFFICIAL' ? 'Ajukan Template Resmi Baru' : 'Buat Balasan Cepat Baru'}
        </h2>
        {tab === 'OFFICIAL' && (
          <div className="flex items-center gap-2">
            <label htmlFor="template-format" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Format
            </label>
            <Select
              id="template-format"
              aria-label="Format template"
              value={format}
              onChange={(e) => setFormat(e.target.value as TemplateFormat)}
              className="w-auto"
            >
              <option value="TEXT">Teks</option>
              <option value="CAROUSEL">Carousel</option>
              <option value="LTO">Penawaran Waktu Terbatas</option>
              <option value="COUPON">Kode Kupon</option>
            </Select>
            {isLto && <span className="text-xs text-muted-foreground">(kategori dikunci ke MARKETING oleh Meta)</span>}
          </div>
        )}
        <div className="grid gap-2 sm:grid-cols-2">
          <Input aria-label="Nama template" placeholder="Nama template" value={name} onChange={(e) => setName(e.target.value)} />
          <Input aria-label="Kategori" placeholder="Kategori" value={category} onChange={(e) => setCategory(e.target.value)} />
        </div>
        <Textarea
          aria-label="Isi pesan"
          placeholder={
            tab === 'OFFICIAL'
              ? isCarousel
                ? 'Isi pesan pembuka carousel, gunakan {{1}}, {{2}}, dst untuk variabel...'
                : 'Isi pesan, gunakan {{1}}, {{2}}, dst untuk variabel...'
              : 'Isi pesan balasan cepat...'
          }
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
        />
        <div className="space-y-1.5">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Variabel</h3>
          {variableNames.map((v, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <Input
                aria-label={`Nama variabel ${i + 1}`}
                placeholder="mis. nama"
                value={v}
                onChange={(e) => updateVariable(i, e.target.value)}
              />
              <button
                type="button"
                aria-label={`Hapus variabel ${i + 1}`}
                onClick={() => removeVariable(i)}
                className="shrink-0 text-muted-foreground hover:text-destructive"
              >
                ✕
              </button>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={addVariable}>
            + Tambah Variabel
          </Button>
        </div>

        {variablePositions.length > 0 && (
          <div className="space-y-1.5 rounded-lg border border-border p-3">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Sumber Nilai Variabel</h3>
            <p className="text-xs text-muted-foreground">
              Pilih data mana yang otomatis mengisi variabel ini setiap kali template dikirim, mengikuti
              chat masing-masing. Kosongkan untuk isi manual saat kirim.
            </p>
            {variablePositions.map(({ position, label }) => (
              <div key={position} className="flex items-center gap-2">
                <span className="w-48 shrink-0 truncate text-sm text-navy">{label}</span>
                <Select
                  aria-label={`Sumber nilai untuk ${label}`}
                  value={variableBindings[String(position)] ?? ''}
                  onChange={(e) =>
                    setVariableBindings((prev) => ({ ...prev, [String(position)]: e.target.value }))
                  }
                  className="w-auto"
                >
                  <option value="">Isi manual</option>
                  {VARIABLE_FIELD_DEFS.map((f) => (
                    <option key={f.key} value={f.key}>
                      {f.label}
                    </option>
                  ))}
                </Select>
              </div>
            ))}
          </div>
        )}

        {isCarousel && (
          <div className="space-y-3 rounded-lg border border-border p-3">
            <h3 className="text-sm font-medium text-navy">Kartu Carousel ({cards.length}/{MAX_CARDS})</h3>
            {cards.map((card, i) => (
              <div key={i} className="space-y-2 rounded-lg border border-border bg-secondary/40 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-muted-foreground">Kartu {i + 1}</span>
                  {cards.length > 1 && (
                    <button
                      type="button"
                      aria-label={`Hapus kartu ${i + 1}`}
                      onClick={() => removeCard(i)}
                      className="text-xs text-destructive hover:underline"
                    >
                      Hapus Kartu
                    </button>
                  )}
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Select
                    aria-label={`Tipe media kartu ${i + 1}`}
                    value={card.mediaType}
                    onChange={(e) => updateCard(i, { mediaType: e.target.value as 'IMAGE' | 'VIDEO' })}
                  >
                    <option value="IMAGE">Gambar</option>
                    <option value="VIDEO">Video</option>
                  </Select>
                  <Input
                    aria-label={`URL media kartu ${i + 1}`}
                    placeholder="URL gambar/video (https://...)"
                    value={card.mediaUrl}
                    onChange={(e) => updateCard(i, { mediaUrl: e.target.value })}
                  />
                </div>
                <Textarea
                  aria-label={`Isi kartu ${i + 1}`}
                  placeholder="Isi kartu..."
                  value={card.bodyText}
                  onChange={(e) => updateCard(i, { bodyText: e.target.value })}
                  rows={2}
                />
                <div className="space-y-1.5">
                  {card.buttons.map((btn, bi) => (
                    <div key={bi} className="flex items-center gap-1.5">
                      <Select
                        aria-label={`Tipe tombol ${bi + 1} kartu ${i + 1}`}
                        value={btn.type}
                        onChange={(e) => updateButton(i, bi, { type: e.target.value as ButtonType })}
                        className="w-auto"
                      >
                        <option value="QUICK_REPLY">Balasan Cepat</option>
                        <option value="URL">Tautan URL</option>
                        <option value="PHONE_NUMBER">Nomor Telepon</option>
                      </Select>
                      <Input
                        aria-label={`Label tombol ${bi + 1} kartu ${i + 1}`}
                        placeholder="Label tombol"
                        value={btn.text}
                        onChange={(e) => updateButton(i, bi, { text: e.target.value })}
                      />
                      {btn.type === 'URL' && (
                        <Input
                          aria-label={`URL tombol ${bi + 1} kartu ${i + 1}`}
                          placeholder="https://..."
                          value={btn.url}
                          onChange={(e) => updateButton(i, bi, { url: e.target.value })}
                        />
                      )}
                      {btn.type === 'PHONE_NUMBER' && (
                        <Input
                          aria-label={`Nomor tombol ${bi + 1} kartu ${i + 1}`}
                          placeholder="+62..."
                          value={btn.phoneNumber}
                          onChange={(e) => updateButton(i, bi, { phoneNumber: e.target.value })}
                        />
                      )}
                      <button
                        type="button"
                        aria-label={`Hapus tombol ${bi + 1} kartu ${i + 1}`}
                        onClick={() => removeButton(i, bi)}
                        className="shrink-0 text-muted-foreground hover:text-destructive"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                  {card.buttons.length < MAX_BUTTONS_PER_CARD && (
                    <Button type="button" variant="outline" size="sm" onClick={() => addButton(i)}>
                      + Tombol
                    </Button>
                  )}
                </div>
              </div>
            ))}
            {cards.length < MAX_CARDS && (
              <Button type="button" variant="outline" size="sm" onClick={addCard}>
                + Kartu
              </Button>
            )}
          </div>
        )}

        {isLto && (
          <div className="space-y-3 rounded-lg border border-border p-3">
            <Input
              aria-label="Judul penawaran"
              placeholder="Judul penawaran (maks. 16 karakter)"
              value={offerTitle}
              maxLength={16}
              onChange={(e) => setOfferTitle(e.target.value)}
            />
            <div className="space-y-1.5">
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Tombol (opsional)</h3>
              {ltoButtons.map((btn, bi) => (
                <div key={bi} className="flex items-center gap-1.5">
                  <Select
                    aria-label={`Tipe tombol ${bi + 1}`}
                    value={btn.type}
                    onChange={(e) => updateLtoButton(bi, { type: e.target.value as ButtonType })}
                    className="w-auto"
                  >
                    <option value="QUICK_REPLY">Balasan Cepat</option>
                    <option value="URL">Tautan URL</option>
                    <option value="PHONE_NUMBER">Nomor Telepon</option>
                  </Select>
                  <Input
                    aria-label={`Label tombol ${bi + 1}`}
                    placeholder="Label tombol"
                    value={btn.text}
                    onChange={(e) => updateLtoButton(bi, { text: e.target.value })}
                  />
                  {btn.type === 'URL' && (
                    <Input
                      aria-label={`URL tombol ${bi + 1}`}
                      placeholder="https://..."
                      value={btn.url}
                      onChange={(e) => updateLtoButton(bi, { url: e.target.value })}
                    />
                  )}
                  {btn.type === 'PHONE_NUMBER' && (
                    <Input
                      aria-label={`Nomor tombol ${bi + 1}`}
                      placeholder="+62..."
                      value={btn.phoneNumber}
                      onChange={(e) => updateLtoButton(bi, { phoneNumber: e.target.value })}
                    />
                  )}
                  <button
                    type="button"
                    aria-label={`Hapus tombol ${bi + 1}`}
                    onClick={() => removeLtoButton(bi)}
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                  >
                    ✕
                  </button>
                </div>
              ))}
              {ltoButtons.length < MAX_LTO_BUTTONS && (
                <Button type="button" variant="outline" size="sm" onClick={addLtoButton}>
                  + Tombol
                </Button>
              )}
            </div>
          </div>
        )}

        {isCoupon && (
          <div className="grid gap-2 sm:grid-cols-2 rounded-lg border border-border p-3">
            <Input
              aria-label="Label tombol kupon"
              placeholder="Label tombol (mis. Salin Kode)"
              value={couponButtonText}
              onChange={(e) => setCouponButtonText(e.target.value)}
            />
            <Input
              aria-label="Contoh kode kupon"
              placeholder="Contoh kode untuk pengajuan (mis. PROMO25)"
              value={couponExampleCode}
              onChange={(e) => setCouponExampleCode(e.target.value)}
            />
          </div>
        )}

        <Button type="button" onClick={createTemplate} disabled={!name.trim() || !body.trim() || !formValid || submitting}>
          {submitting ? 'Menyimpan...' : tab === 'OFFICIAL' ? 'Ajukan ke Meta' : 'Simpan Balasan Cepat'}
        </Button>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </Card>

      <Card className="p-4">
        {loading ? (
          <p className="text-sm text-muted-foreground">Memuat...</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground">Belum ada template.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nama</TableHead>
                <TableHead>Kategori</TableHead>
                <TableHead>Isi</TableHead>
                {tab === 'OFFICIAL' && <TableHead>Status Meta</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-medium text-navy">
                    {t.name}
                    {t.format === 'CAROUSEL' && ' 🎠'}
                    {t.format === 'LTO' && ' ⏳'}
                    {t.format === 'COUPON' && ' 🎟️'}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{t.category ?? '-'}</TableCell>
                  <TableCell className="max-w-xs truncate text-muted-foreground">{t.body}</TableCell>
                  {tab === 'OFFICIAL' && (
                    <TableCell>
                      <Badge variant={metaStatusVariant[t.metaStatus]}>{metaStatusLabel[t.metaStatus]}</Badge>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </main>
  )
}
