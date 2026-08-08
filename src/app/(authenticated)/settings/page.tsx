'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { UserManagementSection } from '@/components/settings/UserManagementSection'
import { WebhookCredentialsPanel } from '@/components/settings/WebhookCredentialsPanel'
import { fetchJson } from '@/lib/fetch-json'

type Settings = {
  defaultChannel: 'OFFICIAL' | 'UNOFFICIAL'
}
type NumberStatus = { officialTokenValid: boolean; unofficialConfigured: boolean }
type Role = 'ADMIN' | 'AGENT' | null

// Bot-specific configuration (kill switch, working hours/auto-reply, LLM model, knowledge
// base) lives on its own /chatbot page now, not here -- this page keeps only what isn't
// specific to the bot: which channel sends by default, the two numbers' own health, and
// user/webhook administration.
export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [status, setStatus] = useState<NumberStatus | null>(null)
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
          <Badge variant={status.unofficialConfigured ? 'success' : 'destructive'}>
            Unofficial: {status.unofficialConfigured ? 'Terkonfigurasi' : 'Belum diatur'}
          </Badge>
        </div>
        {/* Unofficial is send-only -- its own connect/relink is managed on wa-dashboard directly,
            not from here (see src/lib/coexist/client.ts). */}
      </Card>

      {role === 'ADMIN' && (
        <Card className="space-y-1 p-4">
          <h2 className="font-medium text-navy">Biaya percakapan</h2>
          <p className="text-sm text-muted-foreground">
            Histori biaya WhatsApp berdasarkan kategori percakapan (dari Meta).
          </p>
          <Link href="/settings/billing" className="text-sm text-brand hover:underline">
            Lihat histori biaya
          </Link>
        </Card>
      )}

      {role === 'ADMIN' && (
        <Card className="space-y-1 p-4">
          <h2 className="font-medium text-navy">Profil bisnis WhatsApp</h2>
          <p className="text-sm text-muted-foreground">
            Info bisnis yang dilihat pelanggan, status akun, dan pengaturan commerce (dari Meta).
          </p>
          <Link href="/settings/business-profile" className="text-sm text-brand hover:underline">
            Kelola profil bisnis
          </Link>
        </Card>
      )}

      {role === 'ADMIN' && <UserManagementSection />}
      {role === 'ADMIN' && <WebhookCredentialsPanel />}
    </main>
  )
}
