'use client'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { fetchJson } from '@/lib/fetch-json'

type TemplateType = 'OFFICIAL' | 'QUICK_REPLY'
type MetaStatus = 'APPROVED' | 'PENDING' | 'REJECTED' | 'NOT_APPLICABLE'

type Template = {
  id: string
  name: string
  type: TemplateType
  metaStatus: MetaStatus
  category: string | null
  body: string
  variables: string[] | null
  createdAt: string
}

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
  }

  // Templates are what actually gets submitted to Meta (or shown as compose-box shortcuts), so
  // the list must only ever reflect what the server confirmed — no optimistic insert. Await the
  // response, and only append to state once the server has created (and, for OFFICIAL, actually
  // submitted to Meta) the row. On failure, surface the server's error instead of guessing.
  async function createTemplate() {
    if (!name.trim() || !body.trim()) return
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
        <div className="grid gap-2 sm:grid-cols-2">
          <Input aria-label="Nama template" placeholder="Nama template" value={name} onChange={(e) => setName(e.target.value)} />
          <Input aria-label="Kategori" placeholder="Kategori" value={category} onChange={(e) => setCategory(e.target.value)} />
        </div>
        <Textarea
          aria-label="Isi pesan"
          placeholder={tab === 'OFFICIAL' ? 'Isi pesan, gunakan {{1}}, {{2}}, dst untuk variabel...' : 'Isi pesan balasan cepat...'}
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
        <Button type="button" onClick={createTemplate} disabled={!name.trim() || !body.trim() || submitting}>
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
                  <TableCell className="font-medium text-navy">{t.name}</TableCell>
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
