'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { fetchJson } from '@/lib/fetch-json'

type Settings = {
  workingHoursStart: string | null
  workingHoursEnd: string | null
  offHoursAutoReply: string | null
  botAutoReplyAll: boolean
  catalogSyncedAt: string | null
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
      <h1 className="text-xl font-semibold text-navy">Chatbot</h1>

      <Card className="space-y-4 p-4">
        <h2 className="font-medium text-navy">Status</h2>

        <div className="space-y-1.5">
          <div className="flex items-center gap-3">
            <Badge variant={settings.botAutoReplyAll ? 'success' : 'warning'}>
              Bot: {settings.botAutoReplyAll ? 'On (Semua Chat)' : 'Off (Manual per Chat)'}
            </Badge>
            {role === 'ADMIN' && (
              <Button
                onClick={toggleBotMode}
                variant={settings.botAutoReplyAll ? 'destructive' : 'default'}
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
            <Badge variant={gateStatus.readyForApproval ? 'success' : 'warning'}>
              {gateStatus.readyForApproval ? 'Siap' : `Terkunci: ${gateStatus.blocking.join(', ')}`}
            </Badge>
            <Link href="/settings/bot-log" className="text-sm text-brand hover:underline">
              Lihat log bot
            </Link>
          </div>
        </div>
      </Card>

      <Card className="space-y-3 p-4">
        <h2 className="font-medium text-navy">Jam kerja & auto-reply</h2>
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
              disabled={role !== 'ADMIN'}
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
              disabled={role !== 'ADMIN'}
            />
          </div>
        </div>
        <div className="space-y-1">
          <label htmlFor="off-hours-auto-reply" className="text-xs text-muted-foreground">
            Auto-reply di luar jam kerja
          </label>
          <Textarea
            id="off-hours-auto-reply"
            rows={3}
            value={offHoursAutoReply}
            onChange={(e) => setOffHoursAutoReply(e.target.value)}
            disabled={role !== 'ADMIN'}
            placeholder="Contoh: Terima kasih sudah menghubungi kami, tim kami akan membalas pada jam kerja."
          />
        </div>
        {role === 'ADMIN' && (
          <Button onClick={saveWorkingHours} size="sm" disabled={savingHours}>
            {savingHours ? 'Menyimpan...' : 'Simpan'}
          </Button>
        )}
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
            disabled={role !== 'ADMIN'}
          />
        </div>
        {role === 'ADMIN' && (
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
          {role === 'ADMIN' && (
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
