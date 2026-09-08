'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { MessageSquare, Search, Users } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { Select } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { STAGE_LABELS, STAGE_VARIANTS, PIPELINE_STAGES } from '@/lib/pipeline'
import { fetchJson } from '@/lib/fetch-json'

export type ContactRow = {
  id: string
  name: string | null
  phone: string
  conversationId: string | null
  orderChannel: string | null
  pipelineStage: string
  lastContactAt: string | null
  labels: string[]
}

/**
 * Warna kanal pesanan, sama dengan yang dipakai daftar percakapan di Inbox supaya JVTO dan
 * KLOOK terbaca sebagai hal yang sama di kedua layar. Kanal di luar daftar ini jatuh ke
 * tampilan `muted` bawaan Badge, bukan error.
 */
const ORDER_CHANNEL_CLASSES: Record<string, string> = {
  JVTO: 'bg-accent-subtle text-accent',
  KLOOK: 'bg-warning-subtle text-warning',
}

type LabelOption = { id: string; name: string; color: string }

const PAGE_SIZE = 50

export function ContactTable() {
  const [contacts, setContacts] = useState<ContactRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [allLabels, setAllLabels] = useState<LabelOption[]>([])
  const [stage, setStage] = useState('')
  const [labelId, setLabelId] = useState('')
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  // Ketikan ditunda 300 ms sebelum jadi permintaan. Tanpa ini setiap huruf memicu satu query
  // ke database, dan jawaban yang datang tidak berurutan bisa menampilkan hasil dari kata yang
  // sudah tidak diketik lagi.
  useEffect(() => {
    const id = setTimeout(() => {
      setQuery(search.trim())
      setPage(1)
    }, 300)
    return () => clearTimeout(id)
  }, [search])

  // GET /api/contacts has supported ?stage= and ?labelId= since the pipeline feature
  // landed, but nothing in the UI ever sent them. Empty string means "no filter" and is
  // omitted from the query entirely.
  //
  // Berhalaman di SERVER, bukan memotong array di klien: sebelumnya route ini mengirim
  // seluruh tabel kontak (340 baris hari ini, dan tumbuh tiap ada orang baru mengirim pesan)
  // beserta percakapan dan seluruh labelnya. Memotongnya di klien tidak menghemat apa pun —
  // biayanya sudah dibayar sebelum baris pertama sampai ke layar.
  useEffect(() => {
    const params = new URLSearchParams()
    if (stage) params.set('stage', stage)
    if (labelId) params.set('labelId', labelId)
    if (query) params.set('q', query)
    params.set('page', String(page))
    params.set('limit', String(PAGE_SIZE))

    // Failures leave the table on its empty state rather than feeding an error object into
    // `contacts.map`; a 401 has already redirected to /login.
    fetchJson<{ rows: ContactRow[]; total: number }>(`/api/contacts?${params.toString()}`)
      .then((res) => {
        setContacts(res.rows)
        setTotal(res.total)
      })
      .catch(() => {})
  }, [stage, labelId, query, page])

  useEffect(() => {
    // A failed label fetch just leaves the label filter with only its "Semua label"
    // option — the stage filter and the table itself keep working.
    fetchJson<LabelOption[]>('/api/labels')
      .then(setAllLabels)
      .catch(() => {})
  }, [])

  const filtered = Boolean(stage || labelId || query)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1 sm:max-w-80">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-subtle"
            strokeWidth={1.75}
          />
          <Input
            type="search"
            aria-label="Cari kontak"
            placeholder="Cari nama atau nomor..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <Select
          aria-label="Filter tahap pipeline"
          value={stage}
          // Kembali ke halaman 1 setiap filter berubah. Tanpa ini, mengganti filter saat
          // berada di halaman 5 menampilkan halaman kosong dari hasil yang cuma punya 1 halaman.
          onChange={(e) => {
            setStage(e.target.value)
            setPage(1)
          }}
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
          onChange={(e) => {
            setLabelId(e.target.value)
            setPage(1)
          }}
          className="w-auto"
        >
          <option value="">Semua label</option>
          {allLabels.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </Select>
        {/* Jumlah SELURUH hasil, bukan jumlah baris di halaman ini — "50 kontak" pada tabel
            yang sebenarnya berisi 340 adalah kebohongan yang tidak disengaja. */}
        <span className="ml-auto text-xs text-ink-muted tabular-nums">{total} kontak</span>
      </div>

      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        {contacts.length === 0 ? (
          filtered ? (
            <EmptyState
              icon={<Search />}
              title="Tidak ada kontak untuk filter ini"
              description="Longgarkan tahap pipeline atau labelnya untuk melihat lebih banyak."
            />
          ) : (
            <EmptyState
              icon={<Users />}
              title="Belum ada kontak"
              description="Kontak dibuat sendiri begitu ada pesan WhatsApp pertama yang masuk."
            />
          )
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                {/* Lebar kolom disetel eksplisit sejak tabel ini memakai lebar layar penuh:
                    tanpa itu, satu kolom teks (Nama) menelan sisa ruangnya dan Label — satu-
                    satunya kolom yang isinya benar-benar tumbuh — tetap terjepit. */}
                <TableHead className="w-[20%]">Nama</TableHead>
                <TableHead className="w-44">Nomor</TableHead>
                <TableHead className="w-28">Kanal</TableHead>
                <TableHead>Label</TableHead>
                <TableHead className="w-36">Kontak terakhir</TableHead>
                <TableHead className="w-32">Pipeline</TableHead>
                <TableHead className="w-24 text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {contacts.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <Link
                      href={`/contacts/${c.id}`}
                      className="focus-ring rounded-sm font-medium text-ink hover:underline"
                    >
                      {c.name ?? c.phone}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-sm whitespace-nowrap text-ink-muted">{c.phone}</TableCell>
                  <TableCell>
                    {/* NULL berarti data bookingnya belum pernah terbaca, bukan "tidak punya
                        pesanan" — jadi "-", bukan tebakan. */}
                    {c.orderChannel ? (
                      <Badge variant="muted" className={ORDER_CHANNEL_CLASSES[c.orderChannel]}>
                        {c.orderChannel}
                      </Badge>
                    ) : (
                      <span className="text-ink-subtle">-</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {c.labels.length === 0 ? (
                        <span className="text-ink-subtle">-</span>
                      ) : (
                        c.labels.map((label) => (
                          <Badge key={label} variant="default">
                            {label}
                          </Badge>
                        ))
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm whitespace-nowrap text-ink-muted">
                    {c.lastContactAt ? (
                      <time dateTime={c.lastContactAt}>
                        {new Date(c.lastContactAt).toLocaleDateString('id-ID')}
                      </time>
                    ) : (
                      <span className="text-ink-subtle">-</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STAGE_VARIANTS[c.pipelineStage] ?? 'muted'}>
                      {STAGE_LABELS[c.pipelineStage] ?? c.pipelineStage}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {/* Membuka percakapannya langsung, bukan halaman kontaknya: dari daftar ini
                        yang paling sering dituju adalah membalas orangnya. Kontak yang belum
                        pernah berkirim pesan tidak punya percakapan untuk dibuka, jadi tombolnya
                        dimatikan alih-alih menautkan ke Inbox kosong. */}
                    {c.conversationId ? (
                      // `Link` bergaya tombol, bukan `<Button>`: ini navigasi, dan Button di
                      // sistem ini selalu merender <button> — tombol yang menavigasi kehilangan
                      // klik-tengah, buka-tab-baru, dan menu konteks.
                      <Link
                        href={`/inbox?conversation=${c.conversationId}`}
                        className="focus-ring inline-flex h-7 items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 text-sm font-medium text-ink transition-colors hover:bg-surface-sunken"
                      >
                        <MessageSquare aria-hidden="true" className="size-3.5" strokeWidth={1.75} />
                        Chat
                      </Link>
                    ) : (
                      <span className="text-xs text-ink-subtle">Belum ada chat</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Hanya dirender kalau memang ada lebih dari satu halaman: kontrol paginasi pada daftar
          yang muat seluruhnya di satu layar cuma menambah hal untuk dibaca. */}
      {totalPages > 1 && (
        <nav aria-label="Halaman kontak" className="flex items-center justify-between gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
          >
            Sebelumnya
          </Button>
          <span className="text-xs text-ink-muted tabular-nums" aria-live="polite">
            Halaman {page} dari {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
          >
            Berikutnya
          </Button>
        </nav>
      )}
    </div>
  )
}
