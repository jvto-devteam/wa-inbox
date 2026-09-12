'use client'
import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Select } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { TableContainer } from '@/components/ui/table'
import { PageHeader } from '@/components/ui/page-header'
import { fetchJson } from '@/lib/fetch-json'

type KnowledgeGap = {
  id: string
  conversationId: string
  contactName: string | null
  topic: string
  reason: string
  messageText: string
  createdAt: string
  resolvedAt: string | null
}

const REASON_LABEL: Record<string, string> = {
  no_facts_resolved: 'Tidak ada fakta',
  verification_failed: 'Gagal verifikasi',
  reply_unsourced: 'Jawaban tanpa sumber',
}

export default function KnowledgeGapsPage() {
  const [gaps, setGaps] = useState<KnowledgeGap[]>([])
  const [filter, setFilter] = useState('')
  // Keadaan memuat DITURUNKAN dari saringan yang terakhir benar-benar selesai dimuat, bukan
  // diset di awal effect: menyetel state serentak di dalam effect memicu render berantai
  // (aturan yang sama yang dipatuhi halaman Histori Biaya). Saat sebuah permintaan gagal,
  // saringan tetap ditandai selesai supaya daftar tidak memuat selamanya.
  const [loadedFilter, setLoadedFilter] = useState<string | null>(null)
  const [resolving, setResolving] = useState<string | null>(null)
  const loading = loadedFilter !== filter

  async function resolveGap(id: string) {
    setResolving(id)
    try {
      const saved = await fetchJson<{ id: string; resolvedAt: string | null }>(
        `/api/inbox/gaps/${encodeURIComponent(id)}/resolve`,
        { method: 'POST' }
      )
      // Baris itu saja yang diperbarui, bukan seluruh daftar: memuat ulang akan memindahkan
      // posisi baris lain di bawah kursor operator yang sedang menyisir daftar.
      setGaps((prev) => prev.map((gap) => (gap.id === saved.id ? { ...gap, resolvedAt: saved.resolvedAt } : gap)))
    } catch {
      // Ditelan: tombolnya kembali bisa ditekan, dan tidak ada yang hilang kalau gagal.
    } finally {
      setResolving(null)
    }
  }

  useEffect(() => {
    let cancelled = false
    fetchJson<KnowledgeGap[]>(`/api/bot/knowledge-gaps${filter ? `?reason=${filter}` : ''}`)
      .then((next) => {
        if (!cancelled) setGaps(next)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadedFilter(filter)
      })
    return () => {
      cancelled = true
    }
  }, [filter])

  return (
    <main className="mx-auto w-full max-w-[1400px] p-6">
      <PageHeader
        backHref="/settings"
        backLabel="Kembali ke Pengaturan"
        title="Pertanyaan Tak Terjawab"
        description="Pertanyaan pelanggan yang tidak bisa dijawab bot. Setiap baris adalah satu hal yang belum ada di katalog atau di knowledge base."
        actions={
          <Select aria-label="Saring menurut alasan" value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="">Semua alasan</option>
            <option value="no_facts_resolved">Tidak ada fakta</option>
            <option value="verification_failed">Gagal verifikasi</option>
          </Select>
        }
      />

      {/* Permukaan berbatas yang sama dengan tabel Kontak, lewat satu komponen bersama alih-alih
          empat kelas yang disalin ulang. Isinya tetap daftar, bukan tabel: satu-satunya kolom
          yang panjang di sini adalah kalimat pelanggan, dan kalimat tidak berbaris di kolom. */}
      <TableContainer className="mt-6">
        {loading ? (
          <div aria-busy="true" className="flex flex-col gap-3 p-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex flex-col gap-1.5">
                <Skeleton className="h-3.5 w-1/3" />
                <Skeleton className="h-3 w-4/5" />
              </div>
            ))}
          </div>
        ) : gaps.length === 0 ? (
          <EmptyState
            title="Belum ada pertanyaan tak terjawab."
            description={
              filter
                ? 'Tidak ada yang cocok dengan alasan ini. Coba pilih "Semua alasan".'
                : 'Setiap pertanyaan yang masuk sejauh ini bisa dijawab bot.'
            }
          />
        ) : (
          <ul className="divide-y divide-line">
            {gaps.map((g) => (
              <li key={g.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-base font-medium text-ink">{g.topic}</span>
                  <Badge variant="muted">{REASON_LABEL[g.reason] ?? g.reason}</Badge>
                  <span className="text-xs text-ink-muted">{g.contactName ?? g.conversationId}</span>
                  <time dateTime={g.createdAt} className="ml-auto font-mono text-xs text-ink-subtle">
                    {new Date(g.createdAt).toLocaleString('id-ID')}
                  </time>
                  {g.resolvedAt ? (
                    <Badge variant="success">Selesai</Badge>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={resolving === g.id}
                      onClick={() => {
                        void resolveGap(g.id)
                      }}
                    >
                      {resolving === g.id ? 'Menandai...' : 'Tandai selesai'}
                    </Button>
                  )}
                </div>
                {/* Wadahnya ikut melebar, kalimat pelanggannya tidak: baris teks di atas ~80
                    karakter melelahkan dibaca, dan ini satu-satunya bagian baris yang berupa
                    prosa. */}
                <p className="mt-1 max-w-4xl text-sm text-ink-muted">{g.messageText}</p>
              </li>
            ))}
          </ul>
        )}
      </TableContainer>
    </main>
  )
}
