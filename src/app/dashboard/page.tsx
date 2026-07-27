'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { fetchJson } from '@/lib/fetch-json'

type Summary = {
  openCount: number
  handoffTodayCount: number
  officialTokenValid: boolean
  unofficialConnected: boolean
  needsAttention: Array<{ id: string; contactName: string | null; reason: string }>
  remindersDue: Array<{ id: string; note: string; contactName: string | null }>
}

export default function DashboardPage() {
  const [summary, setSummary] = useState<Summary | null>(null)

  useEffect(() => {
    // A rejection here is either "session gone" (fetchJson has already sent the browser to
    // /login) or a server error. Neither should be swallowed into `summary` — leaving it
    // null keeps the "Memuat..." state instead of crashing on `summary.remindersDue.length`.
    fetchJson<Summary>('/api/dashboard/summary')
      .then(setSummary)
      .catch(() => {})
  }, [])

  if (!summary) return <div className="p-6 text-muted-foreground">Memuat...</div>

  return (
    <main className="mx-auto max-w-3xl space-y-8 p-6">
      <h1 className="text-xl font-semibold text-navy">Beranda</h1>

      <section className="grid grid-cols-3 gap-4">
        <Card className="p-4 text-center">
          <p className="text-3xl font-semibold text-navy">{summary.openCount}</p>
          <p className="text-xs text-muted-foreground">Percakapan terbuka</p>
        </Card>
        <Card className="p-4 text-center">
          <p className="text-3xl font-semibold text-navy">{summary.handoffTodayCount}</p>
          <p className="text-xs text-muted-foreground">Di-handoff hari ini</p>
        </Card>
        <Card className="p-4 text-center">
          <p className="text-3xl font-semibold text-navy">{summary.remindersDue.length}</p>
          <p className="text-xs text-muted-foreground">Reminder jatuh tempo</p>
        </Card>
      </section>

      <section className="flex gap-3">
        <Badge variant={summary.officialTokenValid ? 'success' : 'destructive'}>
          Official: {summary.officialTokenValid ? 'Valid' : 'Tidak valid'}
        </Badge>
        <Badge variant={summary.unofficialConnected ? 'success' : 'destructive'}>
          Unofficial: {summary.unofficialConnected ? 'Tersambung' : 'Terputus'}
        </Badge>
      </section>

      <section>
        <h2 className="mb-2 font-medium text-navy">Perlu perhatian</h2>
        <ul className="space-y-1">
          {summary.needsAttention.map((n) => (
            <li key={n.id}>
              <Link href={`/inbox?conversation=${n.id}`} className="text-brand hover:underline">
                {n.contactName ?? n.id}
              </Link>{' '}
              — {n.reason}
            </li>
          ))}
          {summary.needsAttention.length === 0 && (
            <li className="text-muted-foreground">Tidak ada yang perlu perhatian saat ini.</li>
          )}
        </ul>
      </section>

      <section>
        <h2 className="mb-2 font-medium text-navy">Reminder jatuh tempo</h2>
        <ul className="space-y-1">
          {summary.remindersDue.map((r) => (
            <li key={r.id}>
              {r.contactName ?? 'Kontak'}: {r.note}
            </li>
          ))}
          {summary.remindersDue.length === 0 && (
            <li className="text-muted-foreground">Tidak ada reminder jatuh tempo.</li>
          )}
        </ul>
      </section>
    </main>
  )
}
