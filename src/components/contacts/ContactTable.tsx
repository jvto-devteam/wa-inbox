'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
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

    // Failures leave the table on its "Belum ada kontak." empty state rather than feeding
    // an error object into `contacts.map`; a 401 has already redirected to /login.
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
      </div>

      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nama</TableHead>
              <TableHead>Nomor</TableHead>
              <TableHead>Label</TableHead>
              <TableHead>Kontak Terakhir</TableHead>
              <TableHead>Pipeline</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {contacts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                  {stage || labelId ? 'Tidak ada kontak untuk filter ini.' : 'Belum ada kontak.'}
                </TableCell>
              </TableRow>
            ) : (
              contacts.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <Link href={`/contacts/${c.id}`} className="font-medium text-brand hover:underline">
                      {c.name ?? c.phone}
                    </Link>
                  </TableCell>
                  <TableCell>{c.phone}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {c.labels.length === 0 ? (
                        <span className="text-muted-foreground">-</span>
                      ) : (
                        c.labels.map((label) => (
                          <Badge key={label} variant="default">
                            {label}
                          </Badge>
                        ))
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {c.lastContactAt ? new Date(c.lastContactAt).toLocaleDateString('id-ID') : '-'}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STAGE_VARIANTS[c.pipelineStage] ?? 'muted'}>
                      {STAGE_LABELS[c.pipelineStage] ?? c.pipelineStage}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  )
}
