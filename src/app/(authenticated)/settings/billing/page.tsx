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
  // The loaded result carries the range it was fetched for, so `loading` is DERIVED from a
  // mismatch instead of being set synchronously at the top of the effect. Same rendering
  // behaviour -- picking a new range shows "Memuat..." on that very render -- without the
  // cascading re-render React's set-state-in-effect rule (correctly) flags.
  const [loaded, setLoaded] = useState<{ days: number; report: CostReport | null; error: string | null } | null>(null)
  const loading = loaded?.days !== days
  // The previous range's numbers stay on screen while the next ones load; a stale error does
  // not, because it describes a request that is no longer the one being made.
  const report = loaded?.report ?? null
  const error = loaded && loaded.days === days ? loaded.error : null

  useEffect(() => {
    // A slow request for an abandoned range must not overwrite the range the user is now on.
    let cancelled = false
    fetchJson<CostReport>(`/api/analytics/conversation-cost?days=${days}`)
      .then((next) => {
        if (!cancelled) setLoaded({ days, report: next, error: null })
      })
      .catch(() => {
        if (!cancelled) setLoaded({ days, report: null, error: 'Gagal memuat histori biaya dari Meta' })
      })
    return () => {
      cancelled = true
    }
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
