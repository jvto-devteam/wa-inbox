'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, BellOff, CheckCircle2, TriangleAlert } from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { Skeleton } from '@/components/ui/skeleton'
import { fetchJson } from '@/lib/fetch-json'
import { isHandoffLogMessage } from '@/lib/message-display'
import { cn } from '@/lib/utils'

/**
 * BERANDA — layar pertama tiap pagi.
 *
 * Halaman ini menjawab SATU pertanyaan: "chat mana yang menunggu saya sekarang, dan siapa yang
 * paling lama menunggu?" Bentuk sebelumnya menjawab pertanyaan lain — "berapa banyak" — dengan
 * tiga angka besar di atas (percakapan terbuka, handoff hari ini, reminder) yang tidak satu pun
 * bisa diklik ke pekerjaan yang diwakilinya. Angka yang tidak menuntun ke tindakan itu sekarang
 * turun ke strip paling bawah, dan yang naik ke atas adalah daftar orangnya.
 *
 * Urutan isi = urutan mendesaknya:
 *   1. Peringatan saluran — HANYA kalau rusak. Kalau tidak bisa mengirim, semua di bawahnya
 *      tidak bisa dikerjakan, jadi ia mendahului. Saat sehat ia tidak dirender sama sekali.
 *   2. Antrean "menunggu dibalas" — satu-satunya tempat penekanan dibelanjakan di halaman ini.
 *   3. Reminder jatuh tempo — janji yang operator buat ke dirinya sendiri, terikat waktu.
 *   4. Strip angka + baris saluran — konteks, tenang, tetap bisa diklik.
 *
 * TIGA SUMBER DATA, TIDAK ADA YANG DIUBAH:
 *   /api/dashboard/summary   — satu-satunya tempat yang tahu percakapan mana yang di-handoff
 *                              DAN belum dipegang siapa pun (assignedAgentId tidak ada di
 *                              /api/conversations).
 *   /api/conversations       — daftar yang sama dengan sidebar Inbox. Dari sinilah "sudah
 *                              menunggu berapa lama" berasal: summary.needsAttention tidak
 *                              membawa timestamp sama sekali, jadi dengan summary saja antrean
 *                              ini tidak bisa diurutkan menurut lama tunggu.
 *   /api/reminders/due       — dipakai menggantikan summary.remindersDue karena ia membawa
 *                              `dueAt` dan `contactId`; summary hanya membawa nama, jadi
 *                              reminder di sana tidak bisa diklik dan tidak bisa bilang
 *                              "terlambat berapa lama".
 */

type Summary = {
  openCount: number
  handoffTodayCount: number
  officialTokenValid: boolean
  unofficialConfigured: boolean
  needsAttention: Array<{ id: string; contactName: string | null; reason: string }>
  remindersDue: Array<{ id: string; note: string; contactName: string | null }>
}

/** Bentuk baris dari GET /api/conversations — hanya field yang dipakai halaman ini. */
type ConversationRow = {
  id: string
  contactName: string | null
  contactPhone: string
  avatarUrl: string | null
  lastMessage: string | null
  lastMessageSentBy: string | null
  lastMessageAt: string
  botEnabled: boolean
  status: string
  isTest: boolean
}

type DueReminder = {
  id: string
  note: string
  dueAt: string
  contactId: string
  contactName: string | null
}

type DashboardData = {
  summary: Summary
  conversations: ConversationRow[]
  reminders: DueReminder[]
}

type WaitingRow = {
  id: string
  name: string
  avatarUrl: string | null
  preview: string
  /** ISO — waktu pesan terakhir, yaitu titik mulai penantian pelanggan. */
  since: string
  /** Bot sudah menyerah dan belum ada agen yang memegangnya. */
  handedOff: boolean
}

/** Lebih dari sehari tanpa jawaban bukan lagi "antrean", itu masalah. Satu-satunya ambang di file ini. */
const STALE_MS = 24 * 60 * 60 * 1000

const MAX_WAITING_SHOWN = 6

/**
 * "Menunggu manusia" = tidak ada apa pun yang dikatakan ke pelanggan sejak ia terakhir menulis.
 *
 * Dua bentuk, bukan satu: pesan terakhir milik pelanggan, ATAU pesan terakhir adalah baris log
 * handoff (sentBy BOT, content null — lihat src/lib/message-display.ts). Tanpa cabang kedua,
 * percakapan yang BARU SAJA diserahkan bot — justru yang paling mendesak — akan hilang dari
 * antrean ini, karena baris log itu tercatat sesudah pesan pelanggan.
 */
function awaitsHuman(c: ConversationRow): boolean {
  return (
    c.lastMessageSentBy === 'CUSTOMER' ||
    isHandoffLogMessage({ sentBy: c.lastMessageSentBy, content: c.lastMessage })
  )
}

/**
 * Antrean yang sebenarnya, diurut dari yang paling lama menunggu.
 *
 * `botEnabled` sengaja jadi syarat: kalau bot masih aktif di percakapan itu, ia yang menjawab
 * dalam hitungan detik, dan menaruhnya di sini berarti memanggil agen untuk pekerjaan yang tidak
 * ada. Konsekuensinya jujur dan disebut di strip bawah ("Dipegang bot"), bukan disembunyikan.
 *
 * Percakapan sandbox (`isTest`) dikecualikan — di seberangnya bukan pelanggan, melainkan admin
 * yang sedang menguji bot, dan ia dipin ke atas selamanya sehingga akan menetap di antrean ini.
 */
export function buildWaitingList(summary: Summary, conversations: ConversationRow[]): WaitingRow[] {
  const handedOffIds = new Set(summary.needsAttention.map((n) => n.id))

  return conversations
    .filter((c) => !c.isTest && c.status === 'OPEN' && !c.botEnabled && awaitsHuman(c))
    .map((c) => ({
      id: c.id,
      name: c.contactName ?? c.contactPhone,
      avatarUrl: c.avatarUrl,
      // /api/conversations tidak mengembalikan `type` pesan terakhir, jadi pesan tanpa teks
      // (gambar, stiker, lokasi) tidak bisa diberi penanda "[image]" seperti di Inbox. Lebih
      // baik mengaku daripada menampilkan baris kosong yang terbaca sebagai kerusakan.
      preview: isHandoffLogMessage({ sentBy: c.lastMessageSentBy, content: c.lastMessage })
        ? 'Bot menyerahkan ke agen'
        : (c.lastMessage ?? 'Pesan tanpa teks'),
      since: c.lastMessageAt,
      handedOff: handedOffIds.has(c.id),
    }))
    .sort((a, b) => new Date(a.since).getTime() - new Date(b.since).getTime())
}

/**
 * Lama menunggu, dibaca sekilas: "baru saja" / "12 menit" / "4 jam" / "2 hari".
 *
 * Satu satuan saja, tidak pernah "4 jam 12 menit" — yang dipakai operator untuk memutuskan siapa
 * dibalas duluan adalah besaran kasarnya, dan angka yang lebih pendek membuat kolom kanan tidak
 * bergoyang dari baris ke baris. Selisih negatif (jam mesin melenceng dari jam server) jatuh ke
 * "baru saja", bukan angka minus.
 */
export function formatWait(iso: string, now: Date): string {
  const ms = now.getTime() - new Date(iso).getTime()
  if (!Number.isFinite(ms) || ms < 60_000) return 'baru saja'
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 60) return `${minutes} menit`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} jam`
  return `${Math.floor(hours / 24)} hari`
}

function isStale(iso: string, now: Date): boolean {
  return now.getTime() - new Date(iso).getTime() >= STALE_MS
}

/** Reminder: "Pukul 14.00" kalau belum lewat, "Terlambat 2 hari" kalau sudah. */
function formatDue(iso: string, now: Date): { text: string; late: boolean } {
  const due = new Date(iso)
  if (Number.isNaN(due.getTime())) return { text: '', late: false }
  if (due.getTime() <= now.getTime()) {
    const overdue = formatWait(iso, now)
    // formatWait mengembalikan "baru saja" di bawah satu menit; "Terlambat baru saja" bukan
    // kalimat, jadi menit pertama disebut apa adanya.
    return { text: overdue === 'baru saja' ? 'Jatuh tempo sekarang' : `Terlambat ${overdue}`, late: true }
  }
  return { text: `Pukul ${due.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}`, late: false }
}

/** Satu sel angka di strip bawah. Angka mono supaya keempat sel berjajar lurus. */
function ContextCell({ href, value, label }: { href: string; value: number; label: string }) {
  return (
    <Link
      href={href}
      className="focus-ring bg-surface px-4 py-2.5 transition-colors hover:bg-surface-sunken"
    >
      <p className="font-mono text-base font-medium text-ink tabular-nums">{value}</p>
      <p className="mt-0.5 text-xs text-ink-muted">{label}</p>
    </Link>
  )
}

function StatusDot({ ok }: { ok: boolean }) {
  return <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-full', ok ? 'bg-success' : 'bg-danger')} />
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null)
  // Ditandai sekali saat data masuk lalu berdetak tiap menit: isi utama halaman ini adalah
  // "sudah menunggu berapa lama", dan layar yang dibiarkan terbuka sepanjang pagi tidak boleh
  // terus mengaku "4 jam" sampai sore. Dibaca hanya di cabang yang sudah punya data, jadi tidak
  // pernah ikut render server dan tidak bisa memicu ketidakcocokan hidrasi.
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    // Satu Promise.all, bukan tiga fetch yang berdiri sendiri: ketiganya lewat middleware yang
    // sama, jadi kalau satu 401 semuanya 401 (fetchJson sudah melempar browser ke /login) dan
    // kalau satu 500 halaman setengah jadi akan berbohong tentang antrean yang tidak lengkap.
    // Gagal = tetap di kerangka pemuatan, persis seperti sebelum halaman ini punya tiga sumber.
    Promise.all([
      fetchJson<Summary>('/api/dashboard/summary'),
      fetchJson<ConversationRow[]>('/api/conversations'),
      fetchJson<DueReminder[]>('/api/reminders/due'),
    ])
      .then(([summary, conversations, reminders]) => {
        setData({ summary, conversations, reminders })
        setNow(new Date())
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    const tick = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(tick)
  }, [])

  const waiting = useMemo(
    () => (data ? buildWaitingList(data.summary, data.conversations) : []),
    [data]
  )

  if (!data) {
    return (
      <main className="mx-auto max-w-3xl space-y-4 p-6">
        <PageHeader title="Beranda" />
        <div role="status" aria-label="Memuat beranda" className="space-y-4">
          <div className="overflow-hidden rounded-lg border border-line bg-surface">
            <div className="flex items-center gap-3 border-b border-line px-4 py-3">
              <Skeleton className="size-8" />
              <Skeleton className="h-4 w-48" />
            </div>
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-3 border-b border-line px-4 py-2.5 last:border-b-0">
                <Skeleton className="size-8 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-32" />
                  <Skeleton className="h-3 w-2/3" />
                </div>
                <Skeleton className="h-3 w-12" />
              </div>
            ))}
          </div>
          <div className="overflow-hidden rounded-lg border border-line bg-surface">
            <div className="border-b border-line px-4 py-2.5">
              <Skeleton className="h-3.5 w-40" />
            </div>
            <div className="space-y-2 px-4 py-3">
              <Skeleton className="h-3 w-2/3" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
        </div>
      </main>
    )
  }

  const { summary, reminders } = data
  const channelsHealthy = summary.officialTokenValid && summary.unofficialConfigured
  const botHeld = data.conversations.filter((c) => !c.isTest && c.status === 'OPEN' && c.botEnabled).length
  const handedOffCount = waiting.filter((w) => w.handedOff).length
  const shown = waiting.slice(0, MAX_WAITING_SHOWN)
  const hidden = waiting.length - shown.length

  const brokenChannelTitle = !summary.officialTokenValid && !summary.unofficialConfigured
    ? 'Kedua saluran WhatsApp tidak siap mengirim'
    : !summary.officialTokenValid
      ? 'Saluran resmi tidak bisa mengirim pesan'
      : 'Saluran tidak resmi belum diatur'

  return (
    <main className="mx-auto max-w-3xl space-y-4 p-6">
      <PageHeader
        title="Beranda"
        description={now.toLocaleDateString('id-ID', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })}
      />

      {/* Satu-satunya hal di halaman ini yang boleh berteriak, dan ia hanya ada saat memang
          rusak. Kalau pesan tidak bisa keluar, seluruh antrean di bawahnya tidak bisa
          dikerjakan — jadi ia mendahului, bukan jadi lencana di pojok. */}
      {!channelsHealthy && (
        <Link
          href="/settings"
          className="focus-ring flex items-start gap-2.5 rounded-lg border border-danger/35 bg-danger-subtle px-4 py-3"
        >
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-danger" strokeWidth={1.75} />
          <div className="min-w-0">
            <p className="text-base font-medium text-danger">{brokenChannelTitle}</p>
            <p className="text-sm text-ink-muted">
              Balasan bisa gagal terkirim tanpa pemberitahuan. Buka Pengaturan untuk memperbaiki kredensialnya.
            </p>
          </div>
          <ArrowRight aria-hidden="true" className="mt-0.5 ml-auto size-4 shrink-0 text-danger" strokeWidth={1.75} />
        </Link>
      )}

      {/* ANTREAN — pusat halaman. Aksen dibelanjakan di sini dan tidak di tempat lain. */}
      <section className="overflow-hidden rounded-lg border border-line bg-surface">
        {waiting.length === 0 ? (
          // Keadaan kosong yang benar-benar kabar baik: warnanya hijau lembut, bukan abu, dan
          // ia tetap menyebut apa yang sedang berjalan supaya "sepi" tidak terbaca "rusak".
          <div className="flex items-center gap-3 bg-success-subtle px-4 py-3">
            <CheckCircle2 aria-hidden="true" className="size-5 shrink-0 text-success" strokeWidth={1.75} />
            <div className="min-w-0">
              <p className="text-base font-medium text-ink">Tidak ada yang menunggu dibalas</p>
              <p className="text-sm text-ink-muted">
                {botHeld > 0
                  ? `Semua pelanggan sudah dijawab. ${botHeld} chat lain sedang dipegang bot.`
                  : 'Semua pelanggan sudah dijawab.'}
              </p>
            </div>
            <Link
              href="/inbox"
              className="focus-ring ml-auto hidden shrink-0 items-center gap-1 rounded-sm text-sm font-medium text-ink-muted hover:text-ink sm:inline-flex"
            >
              Buka Inbox
              <ArrowRight aria-hidden="true" className="size-3.5" strokeWidth={1.75} />
            </Link>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 border-b border-line px-4 py-3">
              <p className="font-mono text-xl leading-none font-semibold text-accent tabular-nums">
                {waiting.length}
              </p>
              <div className="min-w-0">
                <h2 className="text-base font-medium text-ink">Chat menunggu dibalas</h2>
                <p className="text-sm text-ink-muted">
                  Paling lama {formatWait(waiting[0].since, now)}
                  {handedOffCount > 0 && ` · ${handedOffCount} diserahkan bot`}
                </p>
              </div>
              <Link
                href="/inbox"
                className="focus-ring ml-auto hidden shrink-0 items-center gap-1 rounded-sm text-sm font-medium text-ink-muted hover:text-ink sm:inline-flex"
              >
                Buka Inbox
                <ArrowRight aria-hidden="true" className="size-3.5" strokeWidth={1.75} />
              </Link>
            </div>

            {/* Diurut dari yang paling lama menunggu, bukan dari yang paling baru: yang di baris
                pertama adalah orang yang paling dekat dengan membatalkan atau menulis ulasan
                buruk. Itulah keputusan yang sebenarnya diambil operator di layar ini. */}
            <ul>
              {shown.map((row) => {
                const stale = isStale(row.since, now)
                return (
                  <li key={row.id} className="border-b border-line last:border-b-0">
                    <Link
                      href={`/inbox?conversation=${row.id}`}
                      className="focus-ring flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-sunken"
                    >
                      <Avatar name={row.name} src={row.avatarUrl} alt="" tone="neutral" />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-base font-medium text-ink">{row.name}</span>
                          {row.handedOff && <Badge variant="warning">Diserahkan bot</Badge>}
                        </span>
                        <span className="block truncate text-sm text-ink-muted">{row.preview}</span>
                      </span>
                      <span
                        className={cn(
                          'shrink-0 font-mono text-sm tabular-nums',
                          stale ? 'font-medium text-danger' : 'text-ink-muted'
                        )}
                      >
                        {formatWait(row.since, now)}
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ul>

            {hidden > 0 && (
              <Link
                href="/inbox"
                className="focus-ring flex items-center gap-1 border-t border-line px-4 py-2.5 text-sm font-medium text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink"
              >
                {hidden} chat lain juga menunggu — buka Inbox
                <ArrowRight aria-hidden="true" className="size-3.5" strokeWidth={1.75} />
              </Link>
            )}
          </>
        )}
      </section>

      <section className="overflow-hidden rounded-lg border border-line bg-surface">
        <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
          <h2 className="text-base font-semibold text-ink">Reminder jatuh tempo</h2>
          {reminders.length > 0 && <Badge variant="muted">{reminders.length}</Badge>}
        </div>
        {reminders.length === 0 ? (
          <EmptyState
            icon={<BellOff strokeWidth={1.5} />}
            title="Tidak ada janji yang jatuh tempo"
            description="Reminder yang kamu pasang di halaman kontak muncul di sini pada hari jatuh temponya."
            className="px-4 py-6"
          />
        ) : (
          <ul>
            {reminders.map((r) => {
              const due = formatDue(r.dueAt, now)
              return (
                <li key={r.id} className="border-b border-line last:border-b-0">
                  {/* Reminder melekat pada KONTAK, bukan percakapan (lihat model Reminder di
                      prisma/schema.prisma), jadi tautannya ke halaman kontak — di sanalah
                      daftar reminder-nya bisa ditandai selesai. */}
                  <Link
                    href={`/contacts/${r.contactId}`}
                    className="focus-ring flex items-baseline gap-3 px-4 py-2.5 transition-colors hover:bg-surface-sunken"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-base text-ink">{r.note}</span>
                      <span className="block truncate text-sm text-ink-muted">
                        {r.contactName ?? 'Kontak tanpa nama'}
                      </span>
                    </span>
                    <span
                      className={cn(
                        'shrink-0 font-mono text-sm tabular-nums',
                        due.late ? 'font-medium text-warning' : 'text-ink-muted'
                      )}
                    >
                      {due.text}
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* KONTEKS — angka yang tidak menuntut tindakan, tapi tetap punya tujuan kalau diklik.
          Kecil, mono, tenang. Ini tempat tiga angka yang dulu memenuhi bagian atas halaman. */}
      <section aria-labelledby="konteks-hari-ini" className="space-y-2">
        <h2 id="konteks-hari-ini" className="sr-only">
          Konteks hari ini
        </h2>
        <div className="grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-line bg-line">
          <ContextCell href="/inbox" value={summary.openCount} label="Percakapan terbuka" />
          <ContextCell href="/inbox" value={botHeld} label="Dipegang bot" />
          <ContextCell
            href="/bot-control/decisions"
            value={summary.handoffTodayCount}
            label="Diserahkan bot hari ini"
          />
        </div>

        {/* Rail kiri menyembunyikan titik status kanalnya di bawah md (tooltip tanpa hover),
            jadi di ponsel BARIS INI satu-satunya tempat status kedua saluran terbaca. Karena
            itu ia menyebut keduanya dengan kata, bukan cuma sebuah titik. */}
        <Link
          href="/settings"
          className="focus-ring flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-line bg-surface px-4 py-2.5 text-sm transition-colors hover:bg-surface-sunken"
        >
          <span className="font-medium text-ink">Saluran WhatsApp</span>
          <span className="flex items-center gap-1.5 text-ink-muted">
            <StatusDot ok={summary.officialTokenValid} />
            Resmi — {summary.officialTokenValid ? 'token valid' : 'token tidak valid'}
          </span>
          <span className="flex items-center gap-1.5 text-ink-muted">
            <StatusDot ok={summary.unofficialConfigured} />
            Tidak resmi — {summary.unofficialConfigured ? 'terkonfigurasi' : 'belum diatur'}
          </span>
        </Link>
      </section>
    </main>
  )
}
