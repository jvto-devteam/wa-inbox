'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

type Settings = {
  defaultChannel: 'OFFICIAL' | 'UNOFFICIAL'
  workingHoursStart: string | null
  workingHoursEnd: string | null
  botKillSwitch: boolean
  catalogSyncedAt: string | null
}
type NumberStatus = { officialTokenValid: boolean; unofficialConnected: boolean }
type GateStatus = { readyForApproval: boolean; blocking: string[] }

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [status, setStatus] = useState<NumberStatus | null>(null)
  const [gateStatus, setGateStatus] = useState<GateStatus | null>(null)
  const [syncing, setSyncing] = useState(false)

  useEffect(() => {
    fetch('/api/settings').then((r) => r.json()).then(setSettings)
    fetch('/api/numbers/status').then((r) => r.json()).then(setStatus)
    fetch('/api/bot/gate-status').then((r) => r.json()).then(setGateStatus)
  }, [])

  async function updateDefaultChannel(defaultChannel: 'OFFICIAL' | 'UNOFFICIAL') {
    const res = await fetch('/api/settings', { method: 'PATCH', body: JSON.stringify({ defaultChannel }) })
    setSettings(await res.json())
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
    </main>
  )
}
