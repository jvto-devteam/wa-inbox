'use client'
import { useEffect, useState } from 'react'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { UserManagementSection } from '@/components/settings/UserManagementSection'
import { WebhookCredentialsPanel } from '@/components/settings/WebhookCredentialsPanel'
import { fetchJson } from '@/lib/fetch-json'

type Settings = {
  defaultChannel: 'OFFICIAL' | 'UNOFFICIAL'
}
type NumberStatus = { officialTokenValid: boolean; unofficialConnected: boolean }
type Role = 'ADMIN' | 'AGENT' | null

// Bot-specific configuration (kill switch, working hours/auto-reply, LLM model, knowledge
// base) lives on its own /chatbot page now, not here -- this page keeps only what isn't
// specific to the bot: which channel sends by default, the two numbers' own health, and
// user/webhook administration.
export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [status, setStatus] = useState<NumberStatus | null>(null)
  const [relinking, setRelinking] = useState(false)
  const [relinkError, setRelinkError] = useState<string | null>(null)
  const [role, setRole] = useState<Role>(null)

  useEffect(() => {
    // Each rejection is swallowed: the page renders "Memuat..." until both land, which
    // is the correct resting state for a failure — feeding an `{ error }` body into these
    // typed states instead would render a Settings screen full of undefined values.
    fetchJson<Settings>('/api/settings').then(setSettings).catch(() => {})
    fetchJson<NumberStatus>('/api/numbers/status').then(setStatus).catch(() => {})
    // Backs the admin-only gating below (Manajemen pengguna, Webhook & kredensial). 401
    // (no/invalid session) is treated the same as "no role" — the gated sections stay hidden.
    // Kept on raw fetch rather than fetchJson deliberately: fetchJson redirects on 401, and
    // this probe's whole purpose is to tolerate not being signed in as an admin.
    fetch('/api/session')
      .then((r) => (r.ok ? r.json() : { role: null }))
      .then((data) => setRole(data.role ?? null))
      .catch(() => setRole(null))
  }, [])

  // This PATCH replaces `settings` wholesale with the server's response, so an unchecked
  // non-ok body would put `{ error: '...' }` behind every field this page reads.
  async function updateDefaultChannel(defaultChannel: 'OFFICIAL' | 'UNOFFICIAL') {
    try {
      setSettings(await fetchJson<Settings>('/api/settings', { method: 'PATCH', body: JSON.stringify({ defaultChannel }) }))
    } catch {
      // Leaves the select showing the last server-confirmed value.
    }
  }

  // A relink can take real time — wa-coexist re-pairs the session and our
  // client allows up to 10s for it — so the button gets the same
  // disabled-while-in-flight treatment as "Sinkron Sekarang" below. Without it
  // an impatient admin can fire several concurrent re-pairs at the live
  // company session, which is exactly the operation this endpoint warns about.
  // Failures are surfaced inline rather than silently swallowed: before this,
  // clicking against a down wa-coexist did nothing visible at all.
  async function relink() {
    if (relinking) return
    setRelinking(true)
    setRelinkError(null)
    try {
      const res = await fetch('/api/numbers/relink', { method: 'POST' })
      if (!res.ok) {
        setRelinkError('Gagal menyambungkan ulang — periksa wa-coexist')
        return
      }
      const statusRes = await fetch('/api/numbers/status')
      if (statusRes.ok) setStatus(await statusRes.json())
    } catch {
      setRelinkError('Gagal menyambungkan ulang — periksa wa-coexist')
    } finally {
      setRelinking(false)
    }
  }

  if (!settings || !status) return <div className="p-6 text-sm text-muted-foreground">Memuat...</div>

  return (
    <main className="mx-auto max-w-2xl space-y-8 p-6">
      <h1 className="text-xl font-semibold text-navy">Pengaturan</h1>

      <Card className="space-y-2 p-4">
        <h2 className="font-medium text-navy">Default jalur kirim</h2>
        <Select
          value={settings.defaultChannel}
          onChange={(e) => updateDefaultChannel(e.target.value as 'OFFICIAL' | 'UNOFFICIAL')}
          className="w-auto"
          disabled={role !== 'ADMIN'}
        >
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
          {!status.unofficialConnected && role === 'ADMIN' && (
            <Button onClick={relink} variant="outline" size="sm" disabled={relinking}>
              {relinking ? 'Menyambungkan...' : 'Sambungkan Ulang'}
            </Button>
          )}
        </div>
        {relinkError && <p className="text-xs text-destructive">{relinkError}</p>}
      </Card>

      {role === 'ADMIN' && <UserManagementSection />}
      {role === 'ADMIN' && <WebhookCredentialsPanel />}
    </main>
  )
}
