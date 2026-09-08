'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { BellOff, CheckCircle2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { Skeleton } from '@/components/ui/skeleton'
import { fetchJson } from '@/lib/fetch-json'

type Summary = {
  openCount: number
  handoffTodayCount: number
  officialTokenValid: boolean
  unofficialConfigured: boolean
  needsAttention: Array<{ id: string; contactName: string | null; reason: string }>
  remindersDue: Array<{ id: string; note: string; contactName: string | null }>
}

/** Satu angka besar + keterangannya. Angka selalu mono supaya kolomnya berjajar lurus. */
function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="px-4 py-3">
      <p className="font-mono text-xl leading-tight font-semibold text-ink tabular-nums">{value}</p>
      <p className="mt-0.5 text-xs text-ink-muted">{label}</p>
    </div>
  )
}

/** Kotak berjudul dengan garis rambut — daftar tetap daftar, bukan tumpukan kartu. */
function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-lg border border-line bg-surface">
      <h2 className="border-b border-line px-3 py-2 text-sm font-semibold text-ink">{title}</h2>
      {children}
    </section>
  )
}

export default function DashboardPage() {
  const [summary, setSummary] = useState<Summary | null>(null)

  useEffect(() => {
    // A rejection here is either "session gone" (fetchJson has already sent the browser to
    // /login) or a server error. Neither should be swallowed into `summary` — leaving it
    // null keeps the loading state instead of crashing on `summary.remindersDue.length`.
    fetchJson<Summary>('/api/dashboard/summary')
      .then(setSummary)
      .catch(() => {})
  }, [])

  if (!summary) {
    return (
      <main className="mx-auto max-w-3xl space-y-5 p-6">
        <PageHeader title="Beranda" />
        <div role="status" aria-label="Memuat beranda" className="space-y-5">
          <div className="grid grid-cols-3 divide-x divide-line overflow-hidden rounded-lg border border-line bg-surface">
            {[0, 1, 2].map((i) => (
              <div key={i} className="space-y-2 px-4 py-3">
                <Skeleton className="h-6 w-10" />
                <Skeleton className="h-3 w-24" />
              </div>
            ))}
          </div>
          {[0, 1].map((i) => (
            <div key={i} className="overflow-hidden rounded-lg border border-line bg-surface">
              <div className="border-b border-line px-3 py-2">
                <Skeleton className="h-3.5 w-32" />
              </div>
              <div className="space-y-2 px-3 py-3">
                <Skeleton className="h-3 w-2/3" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-3xl space-y-5 p-6">
      <PageHeader title="Beranda" description="Yang menunggu agen hari ini." />

      <section className="grid grid-cols-3 divide-x divide-line overflow-hidden rounded-lg border border-line bg-surface">
        <Stat value={summary.openCount} label="Percakapan terbuka" />
        <Stat value={summary.handoffTodayCount} label="Di-handoff hari ini" />
        <Stat value={summary.remindersDue.length} label="Reminder jatuh tempo" />
      </section>

      <section className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-line bg-surface px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-sm text-ink-muted">Saluran resmi</span>
          <Badge variant={summary.officialTokenValid ? 'success' : 'destructive'}>
            {summary.officialTokenValid ? 'Valid' : 'Tidak valid'}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-ink-muted">Saluran tidak resmi</span>
          <Badge variant={summary.unofficialConfigured ? 'success' : 'destructive'}>
            {summary.unofficialConfigured ? 'Terkonfigurasi' : 'Belum diatur'}
          </Badge>
        </div>
      </section>

      <Panel title="Perlu perhatian">
        {summary.needsAttention.length === 0 ? (
          <EmptyState
            icon={<CheckCircle2 />}
            title="Tidak ada yang menunggu"
            description="Semua percakapan sudah ditangani atau masih dipegang bot."
          />
        ) : (
          <ul>
            {summary.needsAttention.map((n) => (
              <li key={n.id} className="border-b border-line last:border-b-0">
                <Link
                  href={`/inbox?conversation=${n.id}`}
                  className="focus-ring flex items-baseline justify-between gap-3 px-3 py-2 hover:bg-surface-sunken"
                >
                  <span className="truncate font-medium text-ink">{n.contactName ?? n.id}</span>
                  <span className="shrink-0 text-sm text-ink-muted">{n.reason}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Reminder jatuh tempo">
        {summary.remindersDue.length === 0 ? (
          <EmptyState
            icon={<BellOff />}
            title="Tidak ada reminder jatuh tempo"
            description="Reminder yang dipasang di kontak akan muncul di sini saat waktunya tiba."
          />
        ) : (
          <ul>
            {summary.remindersDue.map((r) => (
              <li key={r.id} className="border-b border-line px-3 py-2 last:border-b-0">
                <p className="text-ink">{r.note}</p>
                <p className="text-xs text-ink-muted">Untuk {r.contactName ?? 'kontak tanpa nama'}</p>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </main>
  )
}
