'use client'
import { useEffect, useState } from 'react'
import { BookOpen, Sparkles, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card'
import { IconButton } from '@/components/ui/icon-button'
import { PageHeader } from '@/components/ui/page-header'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { fetchJson } from '@/lib/fetch-json'
import { VARIABLE_FIELD_DEFS } from '@/lib/booking/variable-fields'
import type { TemplateSuggestion } from '@/lib/bot/template-suggester'
import { BodyField } from '@/components/templates/BodyField'
import { HeaderField, EMPTY_HEADER, type HeaderDraft } from '@/components/templates/HeaderField'
import { FooterField } from '@/components/templates/FooterField'
import { ButtonsField, buttonDraftIsValid, type ButtonDraft, type ButtonType } from '@/components/templates/ButtonsField'
import { TypeSelector, type TemplateFormat } from '@/components/templates/TypeSelector'
import { TemplateGrid, type MetaStatus } from '@/components/templates/TemplateGrid'
import { TemplatePreviewBubble, type TemplatePreviewData } from '@/components/inbox/TemplatePreviewBubble'

type TemplateType = 'OFFICIAL' | 'QUICK_REPLY'

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
  header: HeaderDraft | null
  footer: string | null
  cards: TemplateCard[] | null
  offerTitle: string | null
  buttons: CardButton[] | null
  couponButtonText: string | null
  couponExampleCode: string | null
  createdAt: string
}

// Draft shape for the carousel card builder -- every field is a plain string (even the button
// type selects) so every input stays a controlled component; only converted to the real
// CardButton/TemplateCard union on submit.
type CardDraft = { mediaType: 'IMAGE' | 'VIDEO'; mediaUrl: string; bodyText: string; buttons: ButtonDraft[] }

type LibraryTemplate = {
  id: string
  name: string
  category: string
  language: string
  header: string | null
  body: string
  buttons: Array<{ type: string; text: string; url?: string }>
}

const EMPTY_CARD: CardDraft = { mediaType: 'IMAGE', mediaUrl: '', bodyText: '', buttons: [] }
const MAX_CARDS = 10
const MAX_BUTTONS_PER_CARD = 2
const MAX_BUTTONS = 3

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

function toHeaderPayload(header: HeaderDraft): HeaderDraft {
  if (header.type === 'NONE') return header
  if (header.type === 'TEXT') return { type: 'TEXT', text: header.text.trim() }
  return { ...header, mediaUrl: header.mediaUrl.trim() }
}

function headerIsValid(header: HeaderDraft): boolean {
  if (header.type === 'NONE') return true
  if (header.type === 'TEXT') return header.text.trim() !== ''
  return header.mediaUrl.trim() !== ''
}

// How many distinct {{n}} variables the body currently has -- never a manually-typed name (see
// BodyField's cursor-insert "+ Variabel" button), just a count. Feeds the "Sumber Nilai
// Variabel" binding UI below, the same for OFFICIAL and QUICK_REPLY alike.
function variablePositionsFor(body: string): { position: number; label: string }[] {
  const count = (body.match(/\{\{\d+\}\}/g) ?? []).length
  return Array.from({ length: count }, (_, i) => ({ position: i + 1, label: `{{${i + 1}}}` }))
}

// Same "COPY_CODE dropped, everything else kept" rule applyLibraryTemplate applies when
// pre-filling the form -- the preview must show exactly what picking a result will actually
// produce, not the full raw library button set.
function toLibraryPreview(t: LibraryTemplate): TemplatePreviewData {
  return {
    name: t.name,
    body: t.body,
    format: 'TEXT',
    header: t.header ? { type: 'TEXT', text: t.header } : undefined,
    buttons: t.buttons.filter((b): b is { type: 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER'; text: string; url?: string } => b.type !== 'COPY_CODE'),
  }
}

export default function TemplatesPage() {
  const [tab, setTab] = useState<TemplateType>('OFFICIAL')
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const [name, setName] = useState('')
  const [category, setCategory] = useState('')
  const [body, setBody] = useState('')
  const [format, setFormat] = useState<TemplateFormat>('TEXT')
  const [header, setHeader] = useState<HeaderDraft>(EMPTY_HEADER)
  const [footer, setFooter] = useState('')
  const [buttons, setButtons] = useState<ButtonDraft[]>([])
  const [cards, setCards] = useState<CardDraft[]>([EMPTY_CARD])
  const [offerTitle, setOfferTitle] = useState('')
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
  // Meta's own pre-vetted template library (OFFICIAL tab only) -- browsing here is purely a
  // drafting shortcut: picking a result pre-fills the form below (name/category/body/header/
  // buttons) exactly as if the admin had typed it in by hand, nothing is saved until "Ajukan
  // ke Meta" is pressed.
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [libraryTemplates, setLibraryTemplates] = useState<LibraryTemplate[]>([])
  const [libraryLoading, setLibraryLoading] = useState(false)
  const [libraryError, setLibraryError] = useState<string | null>(null)
  const [libraryCategory, setLibraryCategory] = useState('')
  const [libraryLanguage, setLibraryLanguage] = useState('')
  const [libraryQuery, setLibraryQuery] = useState('')

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
    setFormat('TEXT')
    setHeader(EMPTY_HEADER)
    setFooter('')
    setButtons([])
    setCards([EMPTY_CARD])
    setOfferTitle('')
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

  const isCarousel = tab === 'OFFICIAL' && format === 'CAROUSEL'
  const isLto = tab === 'OFFICIAL' && format === 'LTO'
  const isCoupon = tab === 'OFFICIAL' && format === 'COUPON'
  const isTextOrAuth = tab === 'OFFICIAL' && (format === 'TEXT' || format === 'AUTH')
  const cardsValid = !isCarousel || cards.every(cardDraftIsValid)
  const ltoValid = !isLto || (offerTitle.trim() !== '' && buttons.every(buttonDraftIsValid))
  const couponValid = !isCoupon || (couponButtonText.trim() !== '' && couponExampleCode.trim() !== '')
  const textOrAuthValid = !isTextOrAuth || (headerIsValid(header) && buttons.every(buttonDraftIsValid))
  const formValid = cardsValid && ltoValid && couponValid && textOrAuthValid

  const variablePositions = variablePositionsFor(body)

  // Live preview, fed straight from the draft's own React state -- re-derived on every render,
  // so it updates on every keystroke/onChange with no extra plumbing. Mirrors waba-jvto's own
  // <TemplatePreview>, reusing wa-inbox's existing TemplatePreviewBubble (already used for the
  // list below) instead of a second preview component.
  const previewData: TemplatePreviewData = {
    name,
    body,
    format: tab === 'OFFICIAL' ? format : 'TEXT',
    header: isTextOrAuth ? header : undefined,
    footer: isTextOrAuth || isCoupon ? footer : undefined,
    cards: isCarousel ? cards.map(toCardPayload) : undefined,
    offerTitle: isLto ? offerTitle : undefined,
    buttons: isTextOrAuth || isLto ? buttons.map(toButtonPayload) : undefined,
    couponButtonText: isCoupon ? couponButtonText : undefined,
  }

  // Templates are what actually gets submitted to Meta (or shown as compose-box shortcuts), so
  // the list must only ever reflect what the server confirmed — no optimistic insert. Await the
  // response, and only append to state once the server has created (and, for OFFICIAL, actually
  // submitted to Meta) the row. On failure, surface the server's error instead of guessing.
  async function createTemplate() {
    if (!name.trim() || !body.trim() || !formValid) return
    setError(null)
    setSubmitting(true)
    try {
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
          ...(isCarousel ? { format: 'CAROUSEL', cards: cards.map(toCardPayload) } : {}),
          ...(isLto ? { format: 'LTO', offerTitle: offerTitle.trim(), buttons: buttons.map(toButtonPayload) } : {}),
          ...(isCoupon
            ? {
                format: 'COUPON',
                couponButtonText: couponButtonText.trim(),
                couponExampleCode: couponExampleCode.trim(),
                ...(footer.trim() ? { footer: footer.trim() } : {}),
              }
            : {}),
          ...(isTextOrAuth
            ? {
                format,
                ...(header.type !== 'NONE' ? { header: toHeaderPayload(header) } : {}),
                ...(footer.trim() ? { footer: footer.trim() } : {}),
                ...(buttons.length > 0 ? { buttons: buttons.map(toButtonPayload) } : {}),
              }
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

  // Templates are a shared resource -- removing one silently takes away a reply other agents
  // depend on, so the list must only ever drop a row once the server confirms it's gone.
  async function deleteTemplate(id: string) {
    setError(null)
    try {
      const res = await fetch(`/api/templates/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setError(data?.error ?? 'Gagal menghapus template')
        return
      }
      setTemplates((prev) => prev.filter((t) => t.id !== id))
    } catch {
      setError('Gagal menghapus template')
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

  async function searchLibrary() {
    setLibraryLoading(true)
    setLibraryError(null)
    try {
      const params = new URLSearchParams()
      if (libraryCategory) params.set('category', libraryCategory)
      if (libraryLanguage) params.set('language', libraryLanguage)
      if (libraryQuery) params.set('q', libraryQuery)
      const res = await fetch(`/api/templates/library?${params.toString()}`)
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setLibraryError(data?.error ?? 'Gagal memuat template siap pakai')
        return
      }
      const data = (await res.json()) as { templates: LibraryTemplate[] }
      setLibraryTemplates(data.templates)
    } catch {
      setLibraryError('Gagal memuat template siap pakai')
    } finally {
      setLibraryLoading(false)
    }
  }

  // Only QUICK_REPLY/URL/PHONE_NUMBER map onto ButtonsField's draft shape -- a library result's
  // rare COPY_CODE button is dropped rather than guessed into the unrelated COUPON format's own
  // dedicated fields.
  function applyLibraryTemplate(t: LibraryTemplate) {
    setName(t.name)
    setCategory(t.category)
    setBody(t.body)
    setFormat('TEXT')
    setHeader(t.header ? { type: 'TEXT', text: t.header } : EMPTY_HEADER)
    setFooter('')
    setButtons(
      t.buttons
        .filter((b): b is { type: 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER'; text: string; url?: string } => b.type !== 'COPY_CODE')
        .map((b) => ({ type: b.type, text: b.text, url: b.url ?? '', phoneNumber: '' }))
    )
    setLibraryOpen(false)
  }

  const filtered = templates.filter((t) => t.type === tab)

  return (
    <main className="mx-auto max-w-5xl space-y-5 p-6">
      <PageHeader
        title="Template Pesan"
        description="Pesan siap kirim: template resmi yang disetujui Meta, dan balasan cepat yang hanya dipakai agen."
      />

      <div role="tablist" aria-label="Jenis template" className="flex gap-5 border-b border-line">
        {([
          ['OFFICIAL', 'Resmi (Meta)'],
          ['QUICK_REPLY', 'Balasan Cepat'],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={cn(
              'focus-ring -mb-px border-b-2 px-0.5 pb-2 font-medium transition-colors',
              tab === value ? 'border-accent text-ink' : 'border-transparent text-ink-muted hover:text-ink'
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'QUICK_REPLY' && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5">
              <Sparkles aria-hidden="true" className="size-4 shrink-0 text-ink-subtle" />
              Rekomendasi template dari AI
            </CardTitle>
            <Button type="button" variant="outline" size="sm" onClick={openSuggestions} disabled={suggestLoading}>
              {suggestLoading ? 'Menganalisis...' : 'Buat Rekomendasi'}
            </Button>
          </CardHeader>
          <CardBody className="space-y-3">
            <p className="text-sm text-ink-muted">
              Analisis pertanyaan yang sering masuk dari seluruh chat, lalu usulkan balasan cepat baru.
            </p>
            {suggestOpen && (
              <div className="space-y-3">
                {suggestLoading && (
                  <p className="text-sm text-ink-muted">Menganalisis pesan masuk dari seluruh chat...</p>
                )}
                {suggestError && <p className="text-xs font-medium text-danger">{suggestError}</p>}
                {!suggestLoading && !suggestError && suggestions.length === 0 && (
                  <p className="text-sm text-ink-muted">
                    Belum ada pola pertanyaan yang cukup jelas untuk direkomendasikan.
                  </p>
                )}
                {!suggestLoading && suggestions.length > 0 && (
                  <>
                    <div className="overflow-hidden rounded-md border border-line">
                      {suggestions.map((s, i) => (
                        <label
                          key={i}
                          className="flex cursor-pointer items-start gap-2 border-b border-line px-3 py-2 last:border-b-0 hover:bg-surface-sunken"
                        >
                          <input
                            type="checkbox"
                            checked={selectedSuggestions.has(i)}
                            onChange={() => toggleSuggestion(i)}
                            aria-label={`Pilih rekomendasi ${s.name}`}
                            className="mt-1"
                          />
                          <div className="min-w-0 flex-1 space-y-0.5">
                            <p className="text-sm font-medium text-ink">{s.name}</p>
                            <p className="text-sm text-ink">{s.body}</p>
                            {s.variables.length > 0 && (
                              <p className="text-xs text-ink-muted">
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
                            <p className="text-xs text-ink-subtle italic">{s.reason}</p>
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
          </CardBody>
        </Card>
      )}

      {tab === 'OFFICIAL' && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5">
              <BookOpen aria-hidden="true" className="size-4 shrink-0 text-ink-subtle" />
              Template siap pakai dari Meta
            </CardTitle>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setLibraryOpen((prev) => !prev)
                if (!libraryOpen) searchLibrary()
              }}
            >
              {libraryOpen ? 'Tutup' : 'Jelajahi'}
            </Button>
          </CardHeader>
          <CardBody className="space-y-3">
            <p className="text-sm text-ink-muted">
              Template yang sudah divalidasi Meta, dipakai sebagai titik awal — lebih cepat disetujui daripada
              menulis dari nol.
            </p>
            {libraryOpen && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Select
                    aria-label="Filter kategori"
                    value={libraryCategory}
                    onChange={(e) => setLibraryCategory(e.target.value)}
                    className="w-auto"
                  >
                    <option value="">Semua kategori</option>
                    <option value="MARKETING">Marketing</option>
                    <option value="UTILITY">Utility</option>
                    <option value="AUTHENTICATION">Authentication</option>
                  </Select>
                  <Input
                    aria-label="Filter bahasa"
                    placeholder="Kode bahasa (mis. en_US)"
                    value={libraryLanguage}
                    onChange={(e) => setLibraryLanguage(e.target.value)}
                    className="w-44"
                  />
                  <Input
                    aria-label="Cari template"
                    placeholder="Cari nama/isi..."
                    value={libraryQuery}
                    onChange={(e) => setLibraryQuery(e.target.value)}
                    className="w-52"
                  />
                  <Button type="button" variant="outline" size="sm" onClick={searchLibrary} disabled={libraryLoading}>
                    {libraryLoading ? 'Mencari...' : 'Cari'}
                  </Button>
                </div>
                {libraryError && <p className="text-xs font-medium text-danger">{libraryError}</p>}
                {!libraryLoading && !libraryError && libraryTemplates.length === 0 && (
                  <p className="text-sm text-ink-muted">Tidak ada hasil untuk filter ini.</p>
                )}
                {libraryTemplates.length > 0 && (
                  <div className="grid max-h-96 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
                    {libraryTemplates.map((t) => (
                      <TemplatePreviewBubble key={t.id} template={toLibraryPreview(t)} onClick={() => applyLibraryTemplate(t)} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </CardBody>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardHeader>
            <CardTitle>{tab === 'OFFICIAL' ? 'Ajukan Template Resmi Baru' : 'Buat Balasan Cepat Baru'}</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3">
            {tab === 'OFFICIAL' && (
              <>
                <TypeSelector value={format} onChange={setFormat} />
                {isLto && <p className="text-xs text-ink-muted">Kategori dikunci ke MARKETING oleh Meta.</p>}
                {format === 'AUTH' && <p className="text-xs text-ink-muted">Kategori dikunci ke AUTHENTICATION oleh Meta.</p>}
              </>
            )}

            <div className="grid gap-2 sm:grid-cols-2">
              <Input aria-label="Nama template" placeholder="Nama template" value={name} onChange={(e) => setName(e.target.value)} />
              <Input aria-label="Kategori" placeholder="Kategori" value={category} onChange={(e) => setCategory(e.target.value)} />
            </div>

            {isTextOrAuth && <HeaderField value={header} onChange={setHeader} />}

            <BodyField
              value={body}
              onChange={setBody}
              maxLength={isLto ? 600 : 1024}
              placeholder={
                tab === 'OFFICIAL'
                  ? isCarousel
                    ? 'Isi pesan pembuka carousel...'
                    : 'Isi pesan...'
                  : 'Isi pesan balasan cepat...'
              }
            />

            {(isTextOrAuth || isCoupon) && <FooterField value={footer} onChange={setFooter} />}

            {variablePositions.length > 0 && (
              <div className="space-y-2 rounded-md border border-line p-3">
                <h3 className="text-sm font-medium text-ink">Sumber Nilai Variabel</h3>
                <p className="text-xs text-ink-muted">
                  Pilih data mana yang otomatis mengisi variabel ini setiap kali template dikirim, mengikuti
                  chat masing-masing. Kosongkan untuk isi manual saat kirim.
                </p>
                {variablePositions.map(({ position, label }) => (
                  <div key={position} className="flex items-center gap-2">
                    <span className="w-14 shrink-0 font-mono text-sm text-ink-muted">{label}</span>
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

            {isTextOrAuth && (
              <div className="space-y-2 rounded-md border border-line p-3">
                <h3 className="text-sm font-medium text-ink">Tombol (opsional)</h3>
                <ButtonsField buttons={buttons} onChange={setButtons} max={MAX_BUTTONS} />
              </div>
            )}

            {isCarousel && (
              <div className="space-y-3 rounded-md border border-line p-3">
                <h3 className="text-sm font-medium text-ink">
                  Kartu Carousel ({cards.length}/{MAX_CARDS})
                </h3>
                {cards.map((card, i) => (
                  <div key={i} className="space-y-2 rounded-md border border-line bg-surface-sunken p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-ink-muted">Kartu {i + 1}</span>
                      {cards.length > 1 && (
                        <IconButton
                          size="sm"
                          variant="destructive"
                          label={`Hapus kartu ${i + 1}`}
                          icon={<Trash2 />}
                          onClick={() => removeCard(i)}
                        />
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
                    <BodyField
                      value={card.bodyText}
                      onChange={(value) => updateCard(i, { bodyText: value })}
                      label={`Isi kartu ${i + 1}`}
                      placeholder="Isi kartu..."
                      maxLength={160}
                      rows={2}
                    />
                    <ButtonsField
                      buttons={card.buttons}
                      onChange={(value) => updateCard(i, { buttons: value })}
                      max={MAX_BUTTONS_PER_CARD}
                      labelSuffix={` kartu ${i + 1}`}
                    />
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
              <div className="space-y-3 rounded-md border border-line p-3">
                <Input
                  aria-label="Judul penawaran"
                  placeholder="Judul penawaran (maks. 16 karakter)"
                  value={offerTitle}
                  maxLength={16}
                  onChange={(e) => setOfferTitle(e.target.value)}
                />
                <div className="space-y-2">
                  <h3 className="text-sm font-medium text-ink">Tombol (opsional)</h3>
                  <ButtonsField buttons={buttons} onChange={setButtons} max={MAX_BUTTONS} />
                </div>
              </div>
            )}

            {isCoupon && (
              <div className="grid gap-2 rounded-md border border-line p-3 sm:grid-cols-2">
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

            {error && <p className="text-xs font-medium text-danger">{error}</p>}
          </CardBody>
          <div className="flex items-center justify-end border-t border-line px-4 py-3">
            <Button type="button" onClick={createTemplate} disabled={!name.trim() || !body.trim() || !formValid || submitting}>
              {submitting ? 'Menyimpan...' : tab === 'OFFICIAL' ? 'Ajukan ke Meta' : 'Simpan Balasan Cepat'}
            </Button>
          </div>
        </Card>

        <div className="space-y-2 lg:sticky lg:top-4 lg:self-start" data-testid="template-preview">
          <h2 className="text-sm font-semibold text-ink">Preview</h2>
          <TemplatePreviewBubble template={previewData} />
        </div>
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-ink">
          {tab === 'OFFICIAL' ? 'Template resmi tersimpan' : 'Balasan cepat tersimpan'}
        </h2>
        {loading ? (
          <div
            role="status"
            aria-label="Memuat daftar template"
            className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
          >
            {[0, 1, 2].map((i) => (
              <div key={i} className="space-y-2 rounded-lg border border-line bg-surface p-2">
                <Skeleton className="h-24 w-full rounded-md" />
                <Skeleton className="h-3 w-20" />
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-line bg-surface p-3">
            <TemplateGrid templates={filtered} showStatus={tab === 'OFFICIAL'} onDelete={deleteTemplate} />
          </div>
        )}
      </section>
    </main>
  )
}
