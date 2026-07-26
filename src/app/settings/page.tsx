'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { UserManagementSection } from '@/components/settings/UserManagementSection'
import { WebhookCredentialsPanel } from '@/components/settings/WebhookCredentialsPanel'

type Settings = {
  defaultChannel: 'OFFICIAL' | 'UNOFFICIAL'
  workingHoursStart: string | null
  workingHoursEnd: string | null
  offHoursAutoReply: string | null
  botKillSwitch: boolean
  catalogSyncedAt: string | null
}
type NumberStatus = { officialTokenValid: boolean; unofficialConnected: boolean }
type GateStatus = { readyForApproval: boolean; blocking: string[] }
type Role = 'ADMIN' | 'AGENT' | null

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [status, setStatus] = useState<NumberStatus | null>(null)
  const [gateStatus, setGateStatus] = useState<GateStatus | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [role, setRole] = useState<Role>(null)

  const [workingHoursStart, setWorkingHoursStart] = useState('')
  const [workingHoursEnd, setWorkingHoursEnd] = useState('')
  const [offHoursAutoReply, setOffHoursAutoReply] = useState('')
  const [savingHours, setSavingHours] = useState(false)

  useEffect(() => {
    fetch('/api/settings').then((r) => r.json()).then(setSettings)
    fetch('/api/numbers/status').then((r) => r.json()).then(setStatus)
    fetch('/api/bot/gate-status').then((r) => r.json()).then(setGateStatus)
    // Backs the admin-only gating below (Manajemen pengguna, Webhook &
    // kredensial, and edit rights on Jam kerja). 401 (no/invalid session) is
    // treated the same as "no role" — the gated sections simply stay hidden.
    fetch('/api/session')
      .then((r) => (r.ok ? r.json() : { role: null }))
      .then((data) => setRole(data.role ?? null))
  }, [])

  // Syncs the working-hours form fields from the server whenever `settings`
  // is (re)loaded — including right after saveWorkingHours() PATCHes and
  // replaces `settings` with the server's confirmed values, so the fields
  // never show anything the server hasn't confirmed. Deriving this during
  // render (comparing against the last-synced object) rather than in a
  // useEffect avoids the extra render+effect round trip React recommends
  // against for "adjusting state" from a prop/data change.
  const [syncedSettings, setSyncedSettings] = useState<Settings | null>(null)
  if (settings && settings !== syncedSettings) {
    setSyncedSettings(settings)
    setWorkingHoursStart(settings.workingHoursStart ?? '')
    setWorkingHoursEnd(settings.workingHoursEnd ?? '')
    setOffHoursAutoReply(settings.offHoursAutoReply ?? '')
  }

  async function updateDefaultChannel(defaultChannel: 'OFFICIAL' | 'UNOFFICIAL') {
    const res = await fetch('/api/settings', { method: 'PATCH', body: JSON.stringify({ defaultChannel }) })
    setSettings(await res.json())
  }

  async function saveWorkingHours() {
    setSavingHours(true)
    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        body: JSON.stringify({ workingHoursStart, workingHoursEnd, offHoursAutoReply }),
      })
      setSettings(await res.json())
    } finally {
      setSavingHours(false)
    }
  }

  async function relink() {
    await fetch('/api/numbers/relink', { method: 'POST' })
    fetch('/api/numbers/status').then((r) => r.json()).then(setStatus)
  }

  async function toggleKillSwitch() {
    const res = await fetch('/api/bot/kill-switch', { method: 'POST' })
    const { botKillSwitch } = await res.json()
    setSettings((prev) => (prev ? { ...prev, botKillSwitch } : prev))
  }

  async function syncCatalog() {
    setSyncing(true)
    try {
      await fetch('/api/bot/sync-catalog', { method: 'POST' })
      fetch('/api/settings').then((r) => r.json()).then(setSettings)
      fetch('/api/bot/gate-status').then((r) => r.json()).then(setGateStatus)
    } finally {
      setSyncing(false)
    }
  }

  if (!settings || !status || !gateStatus) return <div className="p-6 text-sm text-muted-foreground">Memuat...</div>

  return (
    <main className="mx-auto max-w-2xl space-y-8 p-6">
      <h1 className="text-xl font-semibold text-navy">Pengaturan</h1>

      <Card className="space-y-2 p-4">
        <h2 className="font-medium text-navy">Default jalur kirim</h2>
        <Select value={settings.defaultChannel} onChange={(e) => updateDefaultChannel(e.target.value as 'OFFICIAL' | 'UNOFFICIAL')} className="w-auto">
          <option value="OFFICIAL">Official</option>
          <option value="UNOFFICIAL">Unofficial</option>
        </Select>
      </Card>

      <Card className="space-y-2 p-4">
        <h2 className="font-medium text-navy">Status nomor</h2>
        <div className="flex items-center gap-3">
          <Badge variant={status.officialTokenValid ? 'success' : 'destructive'}>
            Official: {status.officialTokenValid ? 'Valid' : 'Tidak valid'}
          </Badge>
          <Badge variant={status.unofficialConnected ? 'success' : 'destructive'}>
            Unofficial: {status.unofficialConnected ? 'Tersambung' : 'Terputus'}
          </Badge>
          {!status.unofficialConnected && (
            <Button onClick={relink} variant="outline" size="sm">Sambungkan Ulang</Button>
          )}
        </div>
      </Card>

      <Card className="space-y-4 p-4">
        <h2 className="font-medium text-navy">Bot & Otomasi</h2>

        <div className="space-y-1.5">
          <div className="flex items-center gap-3">
            <Badge variant={settings.botKillSwitch ? 'destructive' : 'success'}>
              Bot: {settings.botKillSwitch ? 'Dimatikan' : 'Aktif'}
            </Badge>
            <Button
              onClick={toggleKillSwitch}
              variant={settings.botKillSwitch ? 'default' : 'destructive'}
              size="sm"
            >
              {settings.botKillSwitch ? 'Aktifkan Bot' : 'Matikan Bot (Darurat)'}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Saat dimatikan, semua pesan langsung dialihkan ke manusia — tanpa pengecualian.
          </p>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">
              Katalog terakhir disinkron: {settings.catalogSyncedAt ? new Date(settings.catalogSyncedAt).toLocaleString('id-ID') : 'Belum pernah'}
            </span>
            <Button onClick={syncCatalog} variant="outline" size="sm" disabled={syncing}>
              {syncing ? 'Menyinkron...' : 'Sinkron Sekarang'}
            </Button>
          </div>
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

      {role === 'ADMIN' && <UserManagementSection />}
      {role === 'ADMIN' && <WebhookCredentialsPanel />}
    </main>
  )
}
