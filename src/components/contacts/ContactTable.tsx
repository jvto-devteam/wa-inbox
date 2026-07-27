'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { STAGE_LABELS, STAGE_VARIANTS } from '@/lib/pipeline'
import { fetchJson } from '@/lib/fetch-json'

export type ContactRow = {
  id: string
  name: string | null
  phone: string
  pipelineStage: string
  lastContactAt: string | null
  labels: string[]
}

export function ContactTable() {
  const [contacts, setContacts] = useState<ContactRow[]>([])

  useEffect(() => {
    // Failures leave the table on its "Belum ada kontak." empty state rather than feeding
    // an error object into `contacts.map`; a 401 has already redirected to /login.
    fetchJson<ContactRow[]>('/api/contacts')
      .then(setContacts)
      .catch(() => {})
  }, [])

  return (
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
                Belum ada kontak.
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
  )
}
