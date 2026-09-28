'use client'
import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { FieldError } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { FormSection } from '@/components/settings/section'
import { fetchJson, FetchJsonError } from '@/lib/fetch-json'

/**
 * Kotak surat Google milik JVTO yang tersambung ke Inbox.
 *
 * Panel ini ada supaya dua kegagalan yang sifatnya DIAM jadi terlihat: token yang dicabut
 * (email berhenti masuk, tanpa error di mana pun) dan push yang mati (email tetap masuk, tapi
 * telat sampai 15 menit). Keduanya tidak pernah dilaporkan siapa pun kalau tidak tampil di sini.
 */
type MailAccountView = {
  id: string
  emailAddress: string
  watchExpiresAt: string | null
  lastSyncAt: string | null
  lastSyncError: string | null
  createdAt: string
}

export const MAIL_FLASH: Record<string, string> = {
  tersambung: 'Kotak surat tersambung. Email baru akan muncul di Inbox dalam beberapa detik.',
  dibatalkan: 'Penyambungan dibatalkan di layar Google.',
  'state-tidak-cocok': 'Sesi penyambungan kedaluwarsa atau tidak cocok. Ulangi dari tombol di bawah.',
  'tanpa-refresh-token': 'Google tidak mengirim token jangka panjang. Cabut akses app ini di akun Google, lalu sambungkan ulang.',
  'izin-kurang': 'Izin membaca DAN mengirim email harus dicentang keduanya di layar Google. Ulangi penyambungan.',
  gagal: 'Penyambungan gagal. Coba lagi; kalau berulang, periksa konfigurasi OAuth di server.',
}

export function describeSyncError(code: string | null): string | null {
  if (code === null) return null
  switch (code) {
    case 'AUTH_REVOKED':
      return 'Akses ke kotak surat dicabut (password diganti atau izin dicabut). Sambungkan ulang.'
    case 'WATCH_FAILED':
      return 'Push gagal diperpanjang. Email tetap masuk lewat tarikan 15 menit.'
    case 'INGEST_FAILED':
      return 'Sebagian email gagal diproses dan akan dicoba lagi otomatis.'
    case 'GMAIL_HTTP':
      return 'Gmail tidak bisa dihubungi. Dicoba lagi otomatis tiap 15 menit.'
    default:
      return `Kesalahan sinkronisasi: ${code}`
  }
}

export function pushStatus(
  watchExpiresAt: string | null,
  pushConfigured: boolean,
  now: Date = new Date(),
): { label: string; tone: 'success' | 'warning' } {
  if (!pushConfigured) return { label: 'Push mati — hanya tarikan 15 menit', tone: 'warning' }
  if (!watchExpiresAt || new Date(watchExpiresAt).getTime() <= now.getTime()) {
    return { label: 'Push belum aktif — menunggu sinkronisasi berikutnya', tone: 'warning' }
  }
  return { label: 'Push aktif', tone: 'success' }
}

const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' }) : '—'

export function MailAccountsPanel() {
  const [accounts, setAccounts] = useState<MailAccountView[] | null>(null)
  const [pushConfigured, setPushConfigured] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  // Inisialisasi lazy (bukan efek yang memanggil setState) supaya dibaca sekali di render
  // pertama sisi klien, sama seperti pola `webhookUrl` di WebhookCredentialsPanel.
  const [flash] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null
    const outcome = new URLSearchParams(window.location.search).get('mail')
    return outcome ? (MAIL_FLASH[outcome] ?? null) : null
  })

  // Rantai .then/.catch, bukan async/await: eslint (react-hooks/set-state-in-effect) menandai
  // efek di bawah kalau ia memanggil sebuah fungsi `async` lokal yang men-setState, meski
  // setState-nya terjadi setelah await. Bentuk promise ini dipakai ulang oleh syncNow juga.
  function load(): Promise<void> {
    return fetchJson<{ pushConfigured: boolean; items: MailAccountView[] }>('/api/mail-accounts')
      .then((data) => {
        setAccounts(data.items)
        setPushConfigured(data.pushConfigured)
      })
      .catch((e: unknown) => setError(e instanceof FetchJsonError ? e.message : 'Gagal memuat kotak surat'))
  }

  useEffect(() => {
    void load()
  }, [])

  async function syncNow() {
    setSyncing(true)
    setError(null)
    try {
      await fetchJson('/api/email/sync', { method: 'POST' })
      await load()
    } catch (e: unknown) {
      setError(e instanceof FetchJsonError ? e.message : 'Gagal menyinkronkan')
    } finally {
      setSyncing(false)
    }
  }

  return (
    <FormSection
      title="Kotak surat email"
      description="Kotak surat Google yang email masuknya tampil di Inbox. Balasan dari Inbox keluar dari alamat yang disurati pelanggan."
      actions={
        <Button type="button" variant="outline" size="sm" onClick={() => void syncNow()} disabled={syncing || !accounts?.length}>
          {syncing ? 'Menyinkronkan...' : 'Sinkron sekarang'}
        </Button>
      }
    >
      <div className="space-y-4">
        {flash && <p role="status" className="rounded-md border border-line bg-surface p-3 text-sm text-ink">{flash}</p>}
        {error && <FieldError className="text-sm">{error}</FieldError>}

        {accounts && accounts.length > 0 && (
          <TableContainer>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Alamat</TableHead>
                  <TableHead>Terakhir berhasil</TableHead>
                  <TableHead>Push</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {accounts.map((account) => {
                  const push = pushStatus(account.watchExpiresAt, pushConfigured)
                  const problem = describeSyncError(account.lastSyncError)
                  return (
                    <TableRow key={account.id}>
                      <TableCell>{account.emailAddress}</TableCell>
                      <TableCell className="text-sm text-ink-muted">{formatDate(account.lastSyncAt)}</TableCell>
                      <TableCell><Badge variant={push.tone}>{push.label}</Badge></TableCell>
                      <TableCell className="text-sm">
                        {problem ? <span className="text-danger">{problem}</span> : <Badge variant="success">Sehat</Badge>}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}

        {accounts && accounts.length === 0 && (
          <p className="text-sm text-ink-muted">Belum ada kotak surat tersambung.</p>
        )}

        {/* Tautan biasa, bukan fetch: OAuth adalah navigasi penuh ke Google dan kembali. Kelas
            di bawah menyamai varian `default` Button (src/components/ui/button.tsx): ini aksi
            utama panel, tapi harus berupa tautan karena OAuth adalah navigasi penuh. */}
        <a
          href="/api/mail-accounts/oauth/start"
          className="inline-flex h-8 items-center rounded-md bg-accent px-3 text-base font-medium text-white hover:bg-accent-hover"
        >
          Sambungkan kotak surat
        </a>
        <p className="text-xs text-ink-muted">
          Menyambungkan ulang alamat yang sudah ada memperbarui aksesnya tanpa kehilangan riwayat.
        </p>
      </div>
    </FormSection>
  )
}
