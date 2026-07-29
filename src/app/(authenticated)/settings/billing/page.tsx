'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { Select } from '@/components/ui/select'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { fetchJson } from '@/lib/fetch-json'

type CostReport = {
  currency: string | null
  totalCost: number
  byCategory: Array<{ category: string; cost: number; conversationCount: number }>
  daily: Array<{ date: string; cost: number }>
}

const CATEGORY_LABEL: Record<string, string> = {
  MARKETING: 'Marketing',
  UTILITY: 'Utility',
  AUTHENTICATION: 'Autentikasi',
  SERVICE: 'Service (gratis)',
  UNKNOWN: 'Tidak diketahui',
}

function formatCost(value: number, currency: string | null): string {
  if (!currency) return value.toFixed(4)
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(value)
  } catch {
    return `${currency} ${value.toFixed(4)}`
  }
}

/**
 * Meta never exposes a WABA's payment-method wallet/threshold balance through any API --
 * that only ever shows in Meta Business Manager's own billing UI. This page surfaces the one
 * piece of billing data that IS queryable: the conversation-based cost breakdown Meta actually
 * bills against, via the Conversation Analytics API (src/lib/meta/analytics.ts).
 */
export default function BillingPage() {
  const [days, setDays] = useState(30)
  const [report, setReport] = useState<CostReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetchJson<CostReport>(`/api/analytics/conversation-cost?days=${days}`)
      .then(setReport)
      .catch(() => setError('Gagal memuat histori biaya dari Meta'))
      .finally(() => setLoading(false))
  }, [days])

  return (
    <main className="mx-auto max-w-3xl space-y-4 p-6">
      <div className="space-y-1">
        <Link href="/settings" className="text-sm text-brand hover:underline">
          &larr; Kembali ke Pengaturan
        </Link>
        <h1 className="text-xl font-semibold text-navy">Histori Biaya Percakapan</h1>
        <p className="text-sm text-muted-foreground">
          Diambil langsung dari Conversation Analytics milik Meta. Saldo/limit penagihan WABA
          sendiri tidak tersedia lewat API apa pun — hanya bisa dicek manual di Meta Business
          Manager.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <label htmlFor="billing-days" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Rentang
        </label>
        <Select id="billing-days" value={String(days)} onChange={(e) => setDays(Number(e.target.value))} className="w-auto">
          <option value="7">7 hari terakhir</option>
          <option value="30">30 hari terakhir</option>
          <option value="90">90 hari terakhir</option>
        </Select>
      </div>

      {loading && <p className="text-sm text-muted-foreground">Memuat...</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}

      {report && (
        <>
          <Card className="space-y-1 p-4">
            <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Total Biaya</h2>
            <p className="text-2xl font-semibold text-navy">{formatCost(report.totalCost, report.currency)}</p>
          </Card>

          <Card className="p-4">
            <h2 className="mb-2 font-medium text-navy">Berdasarkan Kategori</h2>
            {report.byCategory.length === 0 ? (
              <p className="text-sm text-muted-foreground">Tidak ada percakapan berbayar pada rentang ini.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Kategori</TableHead>
                    <TableHead>Jumlah Percakapan</TableHead>
                    <TableHead>Biaya</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.byCategory.map((c) => (
                    <TableRow key={c.category}>
                      <TableCell className="font-medium text-navy">{CATEGORY_LABEL[c.category] ?? c.category}</TableCell>
                      <TableCell className="text-muted-foreground">{c.conversationCount}</TableCell>
                      <TableCell className="text-muted-foreground">{formatCost(c.cost, report.currency)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>

          <Card className="p-4">
            <h2 className="mb-2 font-medium text-navy">Per Hari</h2>
            {report.daily.length === 0 ? (
              <p className="text-sm text-muted-foreground">Tidak ada data pada rentang ini.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tanggal</TableHead>
                    <TableHead>Biaya</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.daily.map((d) => (
                    <TableRow key={d.date}>
                      <TableCell className="text-muted-foreground">{new Date(d.date).toLocaleDateString('id-ID')}</TableCell>
                      <TableCell className="text-muted-foreground">{formatCost(d.cost, report.currency)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        </>
      )}
    </main>
  )
}
