'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Select } from '@/components/ui/select'
import { Card } from '@/components/ui/card'
import { fetchJson } from '@/lib/fetch-json'

type KnowledgeGap = {
  id: string
  conversationId: string
  contactName: string | null
  topic: string
  reason: string
  messageText: string
  createdAt: string
}

export default function KnowledgeGapsPage() {
  const [gaps, setGaps] = useState<KnowledgeGap[]>([])
  const [filter, setFilter] = useState('')

  useEffect(() => {
    fetchJson<KnowledgeGap[]>(`/api/bot/knowledge-gaps${filter ? `?reason=${filter}` : ''}`)
      .then(setGaps)
      .catch(() => {})
  }, [filter])

  return (
    <main className="mx-auto max-w-3xl space-y-4 p-6">
      <div className="space-y-1">
        <Link href="/settings" className="text-sm text-brand hover:underline">
          &larr; Kembali ke Pengaturan
        </Link>
        <h1 className="text-xl font-semibold text-navy">Pertanyaan Tak Terjawab</h1>
      </div>

      <Select value={filter} onChange={(e) => setFilter(e.target.value)} className="w-auto">
        <option value="">Semua</option>
        <option value="no_facts_resolved">Tidak ada fakta</option>
        <option value="verification_failed">Gagal verifikasi</option>
      </Select>

      <Card className="divide-y p-4">
        {gaps.length === 0 && (
          <p className="py-2 text-sm text-muted-foreground">Belum ada pertanyaan tak terjawab.</p>
        )}
        {gaps.map((g) => (
          <div key={g.id} className="py-2 text-sm">
            <div>
              <span className="font-mono uppercase text-brand">{g.topic}</span> — {g.contactName ?? g.conversationId} — {new Date(g.createdAt).toLocaleString('id-ID')}
            </div>
            <p className="text-muted-foreground">{g.messageText}</p>
          </div>
        ))}
      </Card>
    </main>
  )
}
