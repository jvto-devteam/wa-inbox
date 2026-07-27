'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Select } from '@/components/ui/select'
import { Card } from '@/components/ui/card'
import { fetchJson } from '@/lib/fetch-json'

type Decision = { id: string; conversationId: string; contactName: string | null; mode: string; trace: unknown; createdAt: string }

export default function BotLogPage() {
  const [decisions, setDecisions] = useState<Decision[]>([])
  const [filter, setFilter] = useState('')

  useEffect(() => {
    fetchJson<Decision[]>(`/api/bot/decisions${filter ? `?mode=${filter}` : ''}`)
      .then(setDecisions)
      .catch(() => {})
  }, [filter])

  return (
    <main className="mx-auto max-w-3xl space-y-4 p-6">
      <div className="space-y-1">
        <Link href="/settings" className="text-sm text-brand hover:underline">
          &larr; Kembali ke Pengaturan
        </Link>
        <h1 className="text-xl font-semibold text-navy">Log Keputusan Bot</h1>
      </div>

      <Select value={filter} onChange={(e) => setFilter(e.target.value)} className="w-auto">
        <option value="">Semua mode</option>
        <option value="handoff">Handoff</option>
        <option value="faq">FAQ</option>
        <option value="funnel">Funnel</option>
        <option value="booking_context">Konteks Booking</option>
      </Select>

      <Card className="divide-y p-4">
        {decisions.length === 0 && (
          <p className="py-2 text-sm text-muted-foreground">Belum ada keputusan bot.</p>
        )}
        {decisions.map((d) => (
          <div key={d.id} className="py-2 text-sm">
            <span className="font-mono uppercase text-brand">{d.mode}</span> — {d.contactName ?? d.conversationId} — {new Date(d.createdAt).toLocaleString('id-ID')}
          </div>
        ))}
      </Card>
    </main>
  )
}
