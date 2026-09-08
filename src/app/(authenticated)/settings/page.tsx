'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Field, FieldError } from '@/components/ui/label'
import { PageHeader } from '@/components/ui/page-header'
import { Skeleton, SkeletonText } from '@/components/ui/skeleton'
import { FormSection } from '@/components/settings/section'
import { UserManagementSection } from '@/components/settings/UserManagementSection'
import { WebhookCredentialsPanel } from '@/components/settings/WebhookCredentialsPanel'
import { hasAdminPowers } from '@/lib/bot-control/permissions'
import { fetchJson } from '@/lib/fetch-json'
import {
  SAFETY_BOUNDS,
  SAFETY_FIELD_LABELS,
  type SafetyBoundKey,
  type SafetyThresholds,
} from '@/lib/outbound/safety-bounds'

type Settings = {
  defaultChannel: 'OFFICIAL' | 'UNOFFICIAL'
} & SafetyThresholds

const SAFETY_FIELDS = Object.keys(SAFETY_BOUNDS) as SafetyBoundKey[]
type NumberStatus = { officialTokenValid: boolean; unofficialConfigured: boolean }
type Role = 'ADMIN' | 'AGENT' | null

/** Satu baris "kelola di halaman lain": apa isinya, lalu tautannya. */
function LinkRow({ title, description, href, linkLabel }: { title: string; description: string; href: string; linkLabel: string }) {
  return (
    // Garis rambut di ATAS, bukan di bawah: baris-baris ini sekarang duduk di petak dua kolom,
    // dan aturan `last:border-b-0` hanya benar untuk satu lajur — di dua lajur ia menghapus
    // garis pada satu sel dan menyisakannya pada tetangganya.
    <div className="flex flex-wrap items-start justify-between gap-3 border-t border-line py-3">
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-base font-medium text-ink">{title}</p>
        <p className="text-sm text-ink-muted">{description}</p>
      </div>
      <Link
        href={href}
        className="focus-ring rounded-sm text-sm font-medium text-ink underline underline-offset-2 hover:text-ink-muted"
      >
        {linkLabel}
      </Link>
    </div>
  )
}

// Bot-specific configuration (kill switch, working hours/auto-reply, LLM model, knowledge
// base) lives on its own /chatbot page now, not here -- this page keeps only what isn't
// specific to the bot: which channel sends by default, the two numbers' own health, and
// user/webhook administration.
export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [status, setStatus] = useState<NumberStatus | null>(null)
  const [role, setRole] = useState<Role>(null)
  const [safetyError, setSafetyError] = useState<string | null>(null)
  // Bumped only when a save is rejected, to force the number inputs to remount and show the
  // server's value again. Without it the rejected number stays in the box, because the value
  // behind the input's `key` did not change — and a box showing a number that was refused is
  // the exact "setting that looks applied" failure these bounds exist to prevent.
  const [safetyNonce, setSafetyNonce] = useState(0)

  useEffect(() => {
    // Each rejection is swallowed: the page renders its skeleton until both land, which
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

  /**
   * Saves one safety threshold, on blur rather than on every keystroke.
   *
   * The route rejects anything outside SAFETY_BOUNDS, and saving per character would reject
   * every intermediate value an operator types on the way to a valid one ("2" while typing
   * "20"). A rejected save is swallowed the same way the channel select swallows one: the field
   * snaps back to the last value the server confirmed, which is the value actually in force.
   */
  async function updateSafetyField(field: SafetyBoundKey, raw: string) {
    const value = Number(raw)
    if (!Number.isInteger(value) || value === settings?.[field]) {
      setSafetyError(null)
      return
    }
    try {
      setSettings(await fetchJson<Settings>('/api/settings', { method: 'PATCH', body: JSON.stringify({ [field]: value }) }))
      setSafetyError(null)
    } catch (err: unknown) {
      // Named, not silent: an out-of-range number is exactly the case where an operator has to
      // be told the guard kept its floor, or they will believe the value was accepted.
      setSafetyError(err instanceof Error ? err.message : 'Nilai ditolak; pengaman tetap memakai nilai sebelumnya.')
      setSafetyNonce((n) => n + 1)
    }
  }

  if (!settings || !status) {
    return (
      <main aria-busy="true" className="mx-auto w-full max-w-[1400px] p-6">
        <Skeleton className="h-6 w-32" />
        <div className="mt-8 flex flex-col gap-8">
          <SkeletonText lines={3} />
          <SkeletonText lines={3} />
          <SkeletonText lines={4} />
        </div>
      </main>
    )
  }

  const admin = hasAdminPowers(role)

  return (
    <main className="mx-auto w-full max-w-[1400px] p-6">
      <PageHeader
        title="Pengaturan"
        description="Jalur kirim, kesehatan kedua nomor, pengaman outbound, dan akun tim. Setelan bot sendiri ada di halaman Chatbot."
      />

      {/* Dua kolom mulai xl. Empat dari enam bagian di halaman ini isinya satu select, dua
          lencana, atau empat kotak angka — menumpuknya dalam satu lajur 768px adalah bentuk
          paling boros dari halaman yang isinya sesedikit ini. */}
      <div className="mt-6 grid gap-x-10 gap-y-8 xl:grid-cols-2 xl:items-start">
        <FormSection
          title="Default jalur kirim"
          description="Jalur yang dipakai saat pesan keluar tidak menyebut jalurnya sendiri — campaign, balasan bot, dan kiriman dari Inbox."
        >
          <Field label="Jalur default" htmlFor="default-channel" className="max-w-xs">
            <Select
              id="default-channel"
              value={settings.defaultChannel}
              onChange={(e) => updateDefaultChannel(e.target.value as 'OFFICIAL' | 'UNOFFICIAL')}
              className="w-full"
              disabled={!admin}
            >
              <option value="OFFICIAL">Official</option>
              <option value="UNOFFICIAL">Unofficial</option>
            </Select>
          </Field>
        </FormSection>

        {/* Unofficial is send-only -- its own connect/relink is managed on wa-dashboard directly,
            not from here (see src/lib/coexist/client.ts). */}
        {/* Tetangga kanan di baris pertama: garis rambut atasnya hanya benar di bawah xl,
            ketika bagian ini memang berada di bawah "Default jalur kirim". */}
        <FormSection
          className="xl:border-t-0 xl:pt-0"
          title="Status nomor"
          description="Kesehatan kedua nomor seperti yang dilihat aplikasi ini. Nomor Unofficial disambungkan dari wa-dashboard, bukan dari sini."
        >
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={status.officialTokenValid ? 'success' : 'destructive'}>
              Official: {status.officialTokenValid ? 'Valid' : 'Tidak valid'}
            </Badge>
            <Badge variant={status.unofficialConfigured ? 'success' : 'destructive'}>
              Unofficial: {status.unofficialConfigured ? 'Terkonfigurasi' : 'Belum diatur'}
            </Badge>
          </div>
        </FormSection>

        {admin && (
          <FormSection
            className="xl:col-span-2"
            title="Pengaman outbound"
            description={
              <>
                Angka-angka ini dibaca safety guard tepat sebelum sebuah pesan keluar. Batas bawahnya bukan hiasan: nol
                pada batas campaign tidak melonggarkan limit, ia mematikan gerbangnya. Setiap kotak disimpan saat kursor
                meninggalkannya. Jeda provider darurat tidak ada di sini — tombolnya di{' '}
                <Link href="/bot-control/outbound-queue" className="focus-ring rounded-sm underline underline-offset-2 hover:text-ink">
                  Outbound Queue
                </Link>
                , supaya menyimpan halaman ini tidak pernah bisa mengangkat jeda yang dipasang saat insiden.
              </>
            }
          >
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {SAFETY_FIELDS.map((field) => (
                <Field
                  key={field}
                  label={SAFETY_FIELD_LABELS[field]}
                  htmlFor={`safety-${field}`}
                  hint={`Antara ${SAFETY_BOUNDS[field].min} dan ${SAFETY_BOUNDS[field].max}.`}
                >
                  <Input
                    id={`safety-${field}`}
                    type="number"
                    min={SAFETY_BOUNDS[field].min}
                    max={SAFETY_BOUNDS[field].max}
                    defaultValue={settings[field]}
                    key={`${field}-${settings[field]}-${safetyNonce}`}
                    onBlur={(e) => updateSafetyField(field, e.target.value)}
                    className="max-w-56 font-mono"
                  />
                </Field>
              ))}
            </div>
            {safetyError && <FieldError className="mt-3 text-sm">{safetyError}</FieldError>}
          </FormSection>
        )}

        {admin && (
          <FormSection
            className="xl:col-span-2"
            title="Kelola di halaman lain"
            description="Data yang datang dari Meta, dibaca dan diubah di halamannya sendiri."
          >
            <div className="grid gap-x-10 sm:grid-cols-2">
              <LinkRow
                title="Biaya percakapan"
                description="Histori biaya WhatsApp berdasarkan kategori percakapan (dari Meta)."
                href="/settings/billing"
                linkLabel="Lihat histori biaya"
              />
              <LinkRow
                title="Profil bisnis WhatsApp"
                description="Info bisnis yang dilihat pelanggan, status akun, dan pengaturan commerce (dari Meta)."
                href="/settings/business-profile"
                linkLabel="Kelola profil bisnis"
              />
            </div>
          </FormSection>
        )}

        {admin && <UserManagementSection className="xl:col-span-2" />}
        {admin && <WebhookCredentialsPanel className="xl:col-span-2" />}
      </div>
    </main>
  )
}
