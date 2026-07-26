'use client'
import { useEffect, useState } from 'react'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

type Settings = { defaultChannel: 'OFFICIAL' | 'UNOFFICIAL'; workingHoursStart: string | null; workingHoursEnd: string | null }
type NumberStatus = { officialTokenValid: boolean; unofficialConnected: boolean }

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [status, setStatus] = useState<NumberStatus | null>(null)

  useEffect(() => {
    fetch('/api/settings').then((r) => r.json()).then(setSettings)
    fetch('/api/numbers/status').then((r) => r.json()).then(setStatus)
  }, [])

  async function updateDefaultChannel(defaultChannel: 'OFFICIAL' | 'UNOFFICIAL') {
    const res = await fetch('/api/settings', { method: 'PATCH', body: JSON.stringify({ defaultChannel }) })
    setSettings(await res.json())
  }

  async function relink() {
    await fetch('/api/numbers/relink', { method: 'POST' })
    fetch('/api/numbers/status').then((r) => r.json()).then(setStatus)
  }

  if (!settings || !status) return <div className="p-6 text-sm text-muted-foreground">Memuat...</div>

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
    </main>
  )
}
