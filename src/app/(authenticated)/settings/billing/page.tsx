'use client'
import { useEffect, useState } from 'react'
import { EmptyState } from '@/components/ui/empty-state'
import { FieldError } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Skeleton, SkeletonText } from '@/components/ui/skeleton'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { PageHeader } from '@/components/ui/page-header'
import { FormSection } from '@/components/settings/section'
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
  // behaviour -- picking a new range shows the loading state on that very render -- without the
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
    <main className="mx-auto max-w-3xl p-6" aria-busy={loading}>
      <PageHeader
        backHref="/settings"
        backLabel="Kembali ke Pengaturan"
        title="Histori Biaya Percakapan"
        description="Diambil langsung dari Conversation Analytics milik Meta. Saldo/limit penagihan WABA sendiri tidak tersedia lewat API apa pun — hanya bisa dicek manual di Meta Business Manager."
        actions={
          <Select
            id="billing-days"
            aria-label="Rentang"
            value={String(days)}
            onChange={(e) => setDays(Number(e.target.value))}
          >
            <option value="7">7 hari terakhir</option>
            <option value="30">30 hari terakhir</option>
            <option value="90">90 hari terakhir</option>
          </Select>
        }
      />

      {error && <FieldError className="mt-4 text-sm">{error}</FieldError>}

      {loading && !report && (
        <div className="mt-8 flex flex-col gap-8">
          <Skeleton className="h-8 w-40" />
          <SkeletonText lines={4} />
          <SkeletonText lines={4} />
        </div>
      )}

      {report && (
        <div className="mt-6 flex flex-col gap-8">
          <FormSection title="Total biaya" description={`Seluruh percakapan berbayar pada ${days} hari terakhir.`}>
            <p className="font-mono text-xl font-semibold text-ink tabular-nums">
              {formatCost(report.totalCost, report.currency)}
            </p>
          </FormSection>

          <FormSection title="Berdasarkan kategori" description="Kategori percakapan yang ditagihkan Meta.">
            {report.byCategory.length === 0 ? (
              <EmptyState
                title="Tidak ada percakapan berbayar pada rentang ini."
                className="rounded-lg border border-line bg-surface"
              />
            ) : (
              <div className="rounded-lg border border-line bg-surface">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Kategori</TableHead>
                      <TableHead>Jumlah percakapan</TableHead>
                      <TableHead>Biaya</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.byCategory.map((c) => (
                      <TableRow key={c.category}>
                        <TableCell className="font-medium text-ink">{CATEGORY_LABEL[c.category] ?? c.category}</TableCell>
                        <TableCell className="font-mono text-ink-muted">{c.conversationCount}</TableCell>
                        <TableCell className="font-mono text-ink-muted">{formatCost(c.cost, report.currency)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </FormSection>

          <FormSection title="Per hari" description="Biaya harian pada rentang yang dipilih.">
            {report.daily.length === 0 ? (
              <EmptyState title="Tidak ada data pada rentang ini." className="rounded-lg border border-line bg-surface" />
            ) : (
              <div className="rounded-lg border border-line bg-surface">
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
                        <TableCell className="font-mono text-ink-muted">
                          {new Date(d.date).toLocaleDateString('id-ID')}
                        </TableCell>
                        <TableCell className="font-mono text-ink-muted">{formatCost(d.cost, report.currency)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </FormSection>
        </div>
      )}
    </main>
  )
}
