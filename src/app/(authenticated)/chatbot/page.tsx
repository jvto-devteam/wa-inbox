'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { PageHeader } from '@/components/ui/page-header'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { hasAdminPowers } from '@/lib/bot-control/permissions'
import type { AccountRoleName } from '@/lib/auth/session'
import { fetchJson } from '@/lib/fetch-json'

type Settings = {
  workingHoursStart: string | null
  workingHoursEnd: string | null
  offHoursAutoReply: string | null
  botAutoReplyAll: boolean
  skipBotForIndonesianNumbers: boolean
  handoffOnHumanRequest: boolean
  catalogSyncedAt: string | null
  fallbackReply: string | null
  handoffReply: string | null
  ollamaModel: string
}
type GateStatus = { readyForApproval: boolean; blocking: string[] }
type CatalogPackageSummary = { packageKey: string; title: string; destinationTokens: string[]; priceIdr: number | null }
type CatalogSummary = { syncedAt: string | null; packageCount: number; packages: CatalogPackageSummary[] }
type Role = 'ADMIN' | 'AGENT' | null

/**
 * Everything about the bot itself, in one place -- previously split between Pengaturan's
 * "Bot & Otomasi" card and "Jam kerja & auto-reply" card, with no view at all into what the
 * bot's own knowledge base actually contains or which model it's calling. Pengaturan keeps
 * only channel/number/user-admin concerns, which aren't specific to the bot.
 */
export default function ChatbotPage() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [gateStatus, setGateStatus] = useState<GateStatus | null>(null)
  const [catalogSummary, setCatalogSummary] = useState<CatalogSummary | null>(null)
  const [role, setRole] = useState<Role>(null)
  const [syncing, setSyncing] = useState(false)

  const [workingHoursStart, setWorkingHoursStart] = useState('')
  const [workingHoursEnd, setWorkingHoursEnd] = useState('')
  const [offHoursAutoReply, setOffHoursAutoReply] = useState('')
  const [savingHours, setSavingHours] = useState(false)

  const [fallbackReply, setFallbackReply] = useState('')
  const [handoffReply, setHandoffReply] = useState('')
  const [savingSentences, setSavingSentences] = useState(false)
  const [sentenceError, setSentenceError] = useState<string | null>(null)

  const [ollamaModel, setOllamaModel] = useState('')
  const [savingModels, setSavingModels] = useState(false)
  const [modelError, setModelError] = useState<string | null>(null)

  useEffect(() => {
    fetchJson<Settings>('/api/settings').then(setSettings).catch(() => {})
    fetchJson<GateStatus>('/api/bot/gate-status').then(setGateStatus).catch(() => {})
    fetchJson<CatalogSummary>('/api/bot/catalog-summary').then(setCatalogSummary).catch(() => {})
    // Same tolerant pattern as Pengaturan: a 401 here just means the gated (admin-only)
    // controls below stay hidden, not that the whole page fails to render.
    fetch('/api/session')
      .then((r) => (r.ok ? r.json() : { role: null }))
      .then((data) => setRole(data.role ?? null))
      .catch(() => setRole(null))
  }, [])

  // Same derive-during-render sync as Pengaturan's working-hours fields: only ever populated
  // from what the server actually confirmed, never a value the page guessed at.
  const [syncedSettings, setSyncedSettings] = useState<Settings | null>(null)
  if (settings && settings !== syncedSettings) {
    setSyncedSettings(settings)
    setWorkingHoursStart(settings.workingHoursStart ?? '')
    setWorkingHoursEnd(settings.workingHoursEnd ?? '')
    setOffHoursAutoReply(settings.offHoursAutoReply ?? '')
    // '' for null on purpose: an empty box IS "pakai kalimat bawaan", the same state the
    // server stores as NULL, so the two round-trip into each other without a special case.
    setFallbackReply(settings.fallbackReply ?? '')
    setHandoffReply(settings.handoffReply ?? '')
    setOllamaModel(settings.ollamaModel)
  }

  async function toggleBotMode() {
    try {
      const { botAutoReplyAll } = await fetchJson<{ botAutoReplyAll: boolean }>('/api/bot/mode', { method: 'POST' })
      setSettings((prev) => (prev ? { ...prev, botAutoReplyAll } : prev))
    } catch {
      // Badge keeps showing the last confirmed state — never a guessed one.
    }
  }

  async function toggleIndonesiaFilter() {
    try {
      const { skipBotForIndonesianNumbers } = await fetchJson<{ skipBotForIndonesianNumbers: boolean }>(
        '/api/bot/indonesia-filter',
        { method: 'POST' }
      )
      setSettings((prev) => (prev ? { ...prev, skipBotForIndonesianNumbers } : prev))
    } catch {
      // Badge keeps showing the last confirmed state — never a guessed one.
    }
  }

  /**
   * The escalation-classifier switch, saved the moment it is pressed.
   *
   * Deliberately the same edit-save-live pattern as the two switches above it, and deliberately
   * not the draft/review/approve/publish cycle this used to sit behind as a versioned rule
   * row. It is one boolean with two states; the approval round-trip was longer than the change.
   */
  async function toggleHandoffClassifier() {
    if (!settings) return
    try {
      setSettings(
        await fetchJson<Settings>('/api/settings', {
          method: 'PATCH',
          body: JSON.stringify({ handoffOnHumanRequest: !settings.handoffOnHumanRequest }),
        })
      )
    } catch {
      // Badge keeps showing the last confirmed state — never a guessed one.
    }
  }

  async function saveWorkingHours() {
    setSavingHours(true)
    try {
      setSettings(
        await fetchJson<Settings>('/api/settings', {
          method: 'PATCH',
          body: JSON.stringify({ workingHoursStart, workingHoursEnd, offHoursAutoReply }),
        })
      )
    } catch {
      // Leaves the form on the values the server last confirmed.
    } finally {
      setSavingHours(false)
    }
  }

  /**
   * Edit, save, live -- the same pattern as the bot On/Off switch above, and deliberately not a
   * draft/review/publish cycle. These are two sentences; the round trip that would have to be
   * approved is longer than the sentences themselves.
   */
  async function saveSentences() {
    setSentenceError(null)
    setSavingSentences(true)
    try {
      setSettings(
        await fetchJson<Settings>('/api/settings', {
          method: 'PATCH',
          body: JSON.stringify({ fallbackReply, handoffReply }),
        })
      )
    } catch {
      setSentenceError('Gagal menyimpan kalimat bot')
    } finally {
      setSavingSentences(false)
    }
  }

  async function saveModels() {
    if (!ollamaModel.trim()) return
    setModelError(null)
    setSavingModels(true)
    try {
      setSettings(
        await fetchJson<Settings>('/api/settings', {
          method: 'PATCH',
          body: JSON.stringify({ ollamaModel: ollamaModel.trim() }),
        })
      )
    } catch {
      setModelError('Gagal menyimpan model')
    } finally {
      setSavingModels(false)
    }
  }

  async function syncCatalog() {
    setSyncing(true)
    try {
      await fetchJson('/api/bot/sync-catalog', { method: 'POST' })
      await Promise.all([
        fetchJson<Settings>('/api/settings').then(setSettings),
        fetchJson<GateStatus>('/api/bot/gate-status').then(setGateStatus),
        fetchJson<CatalogSummary>('/api/bot/catalog-summary').then(setCatalogSummary),
      ])
    } catch {
      // The "terakhir disinkron" timestamp and package list just stay as they were.
    } finally {
      setSyncing(false)
    }
  }

  if (!settings || !gateStatus || !catalogSummary) return <div className="p-6 text-sm text-muted-foreground">Memuat...</div>

  return (
    <main className="mx-auto max-w-2xl space-y-8 p-6">
      <PageHeader title="Chatbot" />

      <Card className="space-y-4 p-4">
        <h2 className="font-medium text-navy">Status</h2>

        <div className="space-y-1.5">
          <div className="flex items-center gap-3">
            <Badge variant={settings.botAutoReplyAll ? 'success' : 'warning'}>
              Bot: {settings.botAutoReplyAll ? 'On (Semua Chat)' : 'Off (Manual per Chat)'}
            </Badge>
            {/* Tombol-tombol sakelar di kartu ini BUKAN aksen. Keadaannya sudah dibawa oleh
                <Badge> di sebelahnya; tombolnya hanya membalik keadaan itu, dan tiga tombol
                aksen berjajar di satu kartu Status membuat tidak ada satu pun yang terbaca
                sebagai aksi utama halaman. Arah "matikan" tetap memakai destructive karena
                konsekuensinya memang berbeda. */}
            {hasAdminPowers(role) && (
              <Button
                onClick={toggleBotMode}
                variant={settings.botAutoReplyAll ? 'destructive' : 'outline'}
                size="sm"
              >
                {settings.botAutoReplyAll ? 'Matikan (Off)' : 'Aktifkan untuk Semua Chat (On)'}
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            On: bot balas otomatis di semua percakapan. Off: bot nonaktif secara default —
            agen bisa mengaktifkan bot secara manual per percakapan lewat tombol di dalam chat.
          </p>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center gap-3">
            <Badge variant={settings.skipBotForIndonesianNumbers ? 'warning' : 'success'}>
              Nomor Indonesia: {settings.skipBotForIndonesianNumbers ? 'Tidak dibalas bot' : 'Dibalas bot'}
            </Badge>
            {hasAdminPowers(role) && (
              <Button
                onClick={toggleIndonesiaFilter}
                variant={settings.skipBotForIndonesianNumbers ? 'outline' : 'destructive'}
                size="sm"
              >
                {settings.skipBotForIndonesianNumbers ? 'Aktifkan Bot untuk Nomor Indonesia' : 'Nonaktifkan Bot untuk Nomor Indonesia'}
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Saat aktif, bot tidak pernah membalas otomatis ke nomor WhatsApp Indonesia (kode
            +62) — percakapan langsung diam, agen yang menangani manual. Nomor negara lain
            tetap dibalas bot seperti biasa.
          </p>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center gap-3">
            <Badge variant={settings.handoffOnHumanRequest ? 'success' : 'warning'}>
              Alihkan ke manusia: {settings.handoffOnHumanRequest ? 'Aktif' : 'Hanya kata kunci'}
            </Badge>
            {hasAdminPowers(role) && (
              <Button
                onClick={toggleHandoffClassifier}
                variant={settings.handoffOnHumanRequest ? 'destructive' : 'outline'}
                size="sm"
              >
                {settings.handoffOnHumanRequest ? 'Matikan Deteksi Tambahan' : 'Alihkan ke manusia saat customer memintanya'}
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Saat aktif, bot juga memakai LLM untuk menangkap permintaan bicara dengan manusia
            yang tidak memakai kata kunci baku — komplain, frustrasi, kalimat berputar. Saat
            dimatikan, hanya kata kunci eksplisit (&ldquo;mau bicara dengan manusia&rdquo; dan
            sejenisnya) yang memicu handoff; kata kunci itu tidak pernah bisa dimatikan dari
            sini.
          </p>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center gap-3">
            <Badge variant={gateStatus.readyForApproval ? 'success' : 'warning'}>
              {gateStatus.readyForApproval ? 'Siap' : `Terkunci: ${gateStatus.blocking.join(', ')}`}
            </Badge>
            <Link href="/settings/knowledge-gaps" className="text-sm text-brand hover:underline">
              Lihat pertanyaan tak terjawab
            </Link>
          </div>
        </div>
      </Card>

      <Card className="space-y-3 p-4">
        <h2 className="font-medium text-navy">Jam kerja tim</h2>
        <p className="text-xs text-muted-foreground">
          Bot tetap menjawab 24 jam, di dalam maupun di luar jam ini. Yang berubah hanya satu: di luar jam ini,
          pelanggan yang dialihkan ke tim (handoff) ikut diberi tahu kapan tim membalas. Jam dihitung menurut waktu
          Indonesia Barat (WIB), bukan jam server.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <label htmlFor="working-hours-start" className="text-xs text-muted-foreground">
              Mulai
            </label>
            <Input
              id="working-hours-start"
              type="time"
              value={workingHoursStart}
              onChange={(e) => setWorkingHoursStart(e.target.value)}
              disabled={!hasAdminPowers(role)}
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="working-hours-end" className="text-xs text-muted-foreground">
              Selesai
            </label>
            <Input
              id="working-hours-end"
              type="time"
              value={workingHoursEnd}
              onChange={(e) => setWorkingHoursEnd(e.target.value)}
              disabled={!hasAdminPowers(role)}
            />
          </div>
        </div>
        <div className="space-y-1">
          <label htmlFor="off-hours-auto-reply" className="text-xs text-muted-foreground">
            Kalimat tambahan saat handoff di luar jam kerja
          </label>
          <Textarea
            id="off-hours-auto-reply"
            rows={3}
            value={offHoursAutoReply}
            onChange={(e) => setOffHoursAutoReply(e.target.value)}
            disabled={!hasAdminPowers(role)}
            placeholder="Contoh: Saat ini di luar jam operasional kami. Tim akan membalas pada jam kerja berikutnya."
          />
          <p className="text-xs text-muted-foreground">
            Ditambahkan setelah kalimat handoff, bukan menggantikannya. Kosongkan kalau tidak ingin menambah apa-apa
            &mdash; dan kalau salah satu jam di atas kosong, kalimat ini tidak pernah dikirim.
          </p>
        </div>
        {hasAdminPowers(role) && (
          <Button onClick={saveWorkingHours} size="sm" disabled={savingHours}>
            {savingHours ? 'Menyimpan...' : 'Simpan'}
          </Button>
        )}
      </Card>

      <Card className="space-y-3 p-4">
        <h2 className="font-medium text-navy">Kalimat bot</h2>
        <p className="text-xs text-muted-foreground">
          Dua kalimat yang diucapkan bot apa adanya. Disimpan langsung &mdash; begitu ditekan Simpan, percakapan
          berikutnya sudah memakainya.
        </p>
        <div className="space-y-1">
          <label htmlFor="fallback-reply" className="text-xs text-muted-foreground">
            Balasan saat bot tidak tahu jawabannya
          </label>
          <Textarea
            id="fallback-reply"
            rows={3}
            value={fallbackReply}
            onChange={(e) => setFallbackReply(e.target.value)}
            disabled={!hasAdminPowers(role)}
            placeholder="Contoh: Maaf, saya belum punya jawabannya. Saya cek dulu ya."
          />
          <p className="text-xs text-muted-foreground">Kosongkan untuk memakai kalimat bawaan.</p>
        </div>
        <div className="space-y-1">
          <label htmlFor="handoff-reply" className="text-xs text-muted-foreground">
            Kalimat saat percakapan dialihkan ke manusia
          </label>
          <Textarea
            id="handoff-reply"
            rows={3}
            value={handoffReply}
            onChange={(e) => setHandoffReply(e.target.value)}
            disabled={!hasAdminPowers(role)}
            placeholder="Contoh: Terima kasih! Saya hubungkan dengan tim kami, mereka akan segera membalas."
          />
          <p className="text-xs text-muted-foreground">Kosongkan untuk memakai kalimat bawaan.</p>
        </div>
        {hasAdminPowers(role) && (
          <Button onClick={saveSentences} size="sm" disabled={savingSentences}>
            {savingSentences ? 'Menyimpan...' : 'Simpan'}
          </Button>
        )}
        {sentenceError && <p className="text-xs text-destructive">{sentenceError}</p>}
      </Card>

      <Card className="space-y-3 p-4">
        <h2 className="font-medium text-navy">Model LLM</h2>
        <p className="text-xs text-muted-foreground">
          Semua balasan bot diproses lokal lewat Ollama di VPS yang sama — tidak ada penyedia
          hosted (OpenAI dkk) yang pernah dihubungi, jadi teks pelanggan dan data booking tidak
          pernah keluar server. Model default adalah gemma4:31b-cloud, tag cloud Ollama sendiri
          (sama seperti yang dipakai chatbot-web).
        </p>
        <div className="space-y-1">
          <label htmlFor="ollama-model" className="text-xs text-muted-foreground">
            Model Ollama
          </label>
          <Input
            id="ollama-model"
            value={ollamaModel}
            onChange={(e) => setOllamaModel(e.target.value)}
            disabled={!hasAdminPowers(role)}
          />
        </div>
        {hasAdminPowers(role) && (
          <Button onClick={saveModels} size="sm" disabled={savingModels || !ollamaModel.trim()}>
            {savingModels ? 'Menyimpan...' : 'Simpan'}
          </Button>
        )}
        {modelError && <p className="text-xs text-destructive">{modelError}</p>}
      </Card>

      <Card className="space-y-3 p-4">
        <h2 className="font-medium text-navy">Pengetahuan (katalog paket)</h2>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">
            Terakhir disinkron: {catalogSummary.syncedAt ? new Date(catalogSummary.syncedAt).toLocaleString('id-ID') : 'Belum pernah'}
          </span>
          {hasAdminPowers(role) && (
            <Button onClick={syncCatalog} variant="outline" size="sm" disabled={syncing}>
              {syncing ? 'Menyinkron...' : 'Sinkron Sekarang'}
            </Button>
          )}
        </div>
        {catalogSummary.packageCount === 0 ? (
          <p className="text-sm text-muted-foreground">Belum ada paket tersinkron.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Paket</TableHead>
                <TableHead>Destinasi</TableHead>
                <TableHead>Harga</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {catalogSummary.packages.map((p) => (
                <TableRow key={p.packageKey}>
                  <TableCell className="font-medium text-navy">{p.title}</TableCell>
                  <TableCell className="text-muted-foreground">{p.destinationTokens.join(', ')}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {p.priceIdr != null ? `Rp ${p.priceIdr.toLocaleString('id-ID')}` : '-'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </main>
  )
}
