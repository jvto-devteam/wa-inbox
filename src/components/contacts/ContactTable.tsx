'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Search, Users } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { Select } from '@/components/ui/select'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { STAGE_LABELS, STAGE_VARIANTS, PIPELINE_STAGES } from '@/lib/pipeline'
import { fetchJson } from '@/lib/fetch-json'

export type ContactRow = {
  id: string
  name: string | null
  phone: string
  pipelineStage: string
  lastContactAt: string | null
  labels: string[]
}

type LabelOption = { id: string; name: string; color: string }

export function ContactTable() {
  const [contacts, setContacts] = useState<ContactRow[]>([])
  const [allLabels, setAllLabels] = useState<LabelOption[]>([])
  const [stage, setStage] = useState('')
  const [labelId, setLabelId] = useState('')

  // GET /api/contacts has supported ?stage= and ?labelId= since the pipeline feature
  // landed, but nothing in the UI ever sent them. Empty string means "no filter" and is
  // omitted from the query entirely, so an unfiltered load stays byte-identical to before.
  useEffect(() => {
    const params = new URLSearchParams()
    if (stage) params.set('stage', stage)
    if (labelId) params.set('labelId', labelId)
    const query = params.toString()

    // Failures leave the table on its empty state rather than feeding an error object into
    // `contacts.map`; a 401 has already redirected to /login.
    fetchJson<ContactRow[]>(`/api/contacts${query ? `?${query}` : ''}`)
      .then(setContacts)
      .catch(() => {})
  }, [stage, labelId])

  useEffect(() => {
    // A failed label fetch just leaves the label filter with only its "Semua label"
    // option — the stage filter and the table itself keep working.
    fetchJson<LabelOption[]>('/api/labels')
      .then(setAllLabels)
      .catch(() => {})
  }, [])

  const filtered = Boolean(stage || labelId)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          aria-label="Filter tahap pipeline"
          value={stage}
          onChange={(e) => setStage(e.target.value)}
          className="w-auto"
        >
          <option value="">Semua tahap</option>
          {PIPELINE_STAGES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Filter label"
          value={labelId}
          onChange={(e) => setLabelId(e.target.value)}
          className="w-auto"
        >
          <option value="">Semua label</option>
          {allLabels.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </Select>
        <span className="ml-auto text-xs text-ink-muted tabular-nums">{contacts.length} kontak</span>
      </div>

      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        {contacts.length === 0 ? (
          filtered ? (
            <EmptyState
              icon={<Search />}
              title="Tidak ada kontak untuk filter ini"
              description="Longgarkan tahap pipeline atau labelnya untuk melihat lebih banyak."
            />
          ) : (
            <EmptyState
              icon={<Users />}
              title="Belum ada kontak"
              description="Kontak dibuat sendiri begitu ada pesan WhatsApp pertama yang masuk."
            />
          )
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nama</TableHead>
                <TableHead>Nomor</TableHead>
                <TableHead>Label</TableHead>
                <TableHead>Kontak terakhir</TableHead>
                <TableHead>Pipeline</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {contacts.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <Link
                      href={`/contacts/${c.id}`}
                      className="focus-ring rounded-sm font-medium text-ink hover:underline"
                    >
                      {c.name ?? c.phone}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-sm text-ink-muted">{c.phone}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {c.labels.length === 0 ? (
                        <span className="text-ink-subtle">-</span>
                      ) : (
                        c.labels.map((label) => (
                          <Badge key={label} variant="default">
                            {label}
                          </Badge>
                        ))
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-ink-muted">
                    {c.lastContactAt ? (
                      <time dateTime={c.lastContactAt}>
                        {new Date(c.lastContactAt).toLocaleDateString('id-ID')}
                      </time>
                    ) : (
                      <span className="text-ink-subtle">-</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STAGE_VARIANTS[c.pipelineStage] ?? 'muted'}>
                      {STAGE_LABELS[c.pipelineStage] ?? c.pipelineStage}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  )
}
