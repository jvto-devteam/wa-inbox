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

type TemplateType = 'OFFICIAL' | 'QUICK_REPLY'
type TemplateFormat = 'TEXT' | 'CAROUSEL'
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
  cards: TemplateCard[] | null
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
  return card.mediaUrl.trim() !== '' && card.bodyText.trim() !== '' && card.buttons.every((b) => {
    if (!b.text.trim()) return false
    if (b.type === 'URL') return b.url.trim() !== ''
    if (b.type === 'PHONE_NUMBER') return b.phoneNumber.trim() !== ''
    return true
  })
}

function toCardPayload(card: CardDraft): TemplateCard {
  return {
    mediaType: card.mediaType,
    mediaUrl: card.mediaUrl.trim(),
    bodyText: card.bodyText.trim(),
    buttons: card.buttons.map((b): CardButton => {
      if (b.type === 'URL') return { type: 'URL', text: b.text.trim(), url: b.url.trim() }
      if (b.type === 'PHONE_NUMBER') return { type: 'PHONE_NUMBER', text: b.text.trim(), phoneNumber: b.phoneNumber.trim() }
      return { type: 'QUICK_REPLY', text: b.text.trim() }
    }),
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
  const [variablesText, setVariablesText] = useState('')
  const [format, setFormat] = useState<TemplateFormat>('TEXT')
  const [cards, setCards] = useState<CardDraft[]>([EMPTY_CARD])

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
    setVariablesText('')
    setFormat('TEXT')
    setCards([EMPTY_CARD])
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

  const isCarousel = tab === 'OFFICIAL' && format === 'CAROUSEL'
  const cardsValid = !isCarousel || cards.every(cardDraftIsValid)

  // Templates are what actually gets submitted to Meta (or shown as compose-box shortcuts), so
  // the list must only ever reflect what the server confirmed — no optimistic insert. Await the
  // response, and only append to state once the server has created (and, for OFFICIAL, actually
  // submitted to Meta) the row. On failure, surface the server's error instead of guessing.
  async function createTemplate() {
    if (!name.trim() || !body.trim() || !cardsValid) return
    setError(null)
    setSubmitting(true)
    try {
      const variables = variablesText
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean)

      const res = await fetch('/api/templates', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          type: tab,
          category: category.trim() || undefined,
          body: body.trim(),
          ...(tab === 'OFFICIAL' ? { variables } : {}),
          ...(isCarousel ? { format: 'CAROUSEL', cards: cards.map(toCardPayload) } : {}),
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
            </Select>
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
        {tab === 'OFFICIAL' && (
          <Input
            aria-label="Variabel"
            placeholder="Variabel, pisahkan dengan koma (mis. nama, tanggal)"
            value={variablesText}
            onChange={(e) => setVariablesText(e.target.value)}
          />
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

        <Button type="button" onClick={createTemplate} disabled={!name.trim() || !body.trim() || !cardsValid || submitting}>
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
