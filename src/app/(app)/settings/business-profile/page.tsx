'use client'
import { useEffect, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Field, FieldError } from '@/components/ui/label'
import { Skeleton, SkeletonText } from '@/components/ui/skeleton'
import { PageHeader } from '@/components/ui/page-header'
import { FormSection } from '@/components/settings/section'
import { fetchJson } from '@/lib/fetch-json'

type BusinessProfile = {
  about: string | null
  address: string | null
  description: string | null
  email: string | null
  vertical: string | null
  websites: string[]
  profilePictureUrl: string | null
}

type BusinessAccount = {
  id: string
  name: string | null
  timezoneId: string | null
  accountReviewStatus: string | null
  businessVerificationStatus: string | null
}

type CommerceSettings = { isCartEnabled: boolean; isCatalogVisible: boolean }

const REVIEW_STATUS_VARIANT: Record<string, 'success' | 'warning' | 'destructive' | 'muted'> = {
  APPROVED: 'success',
  PENDING: 'warning',
  REJECTED: 'destructive',
}

/** Satu sakelar commerce: apa yang dilihat pelanggan kalau dinyalakan, lalu kotak centangnya. */
function CommerceRow({
  title,
  description,
  ariaLabel,
  checked,
  disabled,
  onToggle,
}: {
  title: string
  description: string
  ariaLabel: string
  checked: boolean
  disabled: boolean
  onToggle: () => void
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 border-b border-line py-3 first:pt-0 last:border-b-0 last:pb-0">
      <span className="min-w-0 flex-1">
        <span className="block text-base font-medium text-ink">{title}</span>
        <span className="mt-0.5 block text-sm text-ink-muted">{description}</span>
      </span>
      <input
        type="checkbox"
        aria-label={ariaLabel}
        className="focus-ring mt-1 size-4 shrink-0"
        checked={checked}
        disabled={disabled}
        onChange={onToggle}
      />
    </label>
  )
}

/**
 * Business identity + account status Meta Business Suite otherwise shows, plus the
 * shopping-cart/catalog toggle -- all backed by the real Meta Graph API
 * (src/lib/meta/business-account.ts), not any third-party layer.
 */
export default function BusinessProfilePage() {
  const [profile, setProfile] = useState<BusinessProfile | null>(null)
  const [account, setAccount] = useState<BusinessAccount | null>(null)
  const [commerce, setCommerce] = useState<CommerceSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const [commerceSaving, setCommerceSaving] = useState(false)
  const [commerceError, setCommerceError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      fetchJson<{ profile: BusinessProfile; account: BusinessAccount }>('/api/settings/business-profile'),
      fetchJson<CommerceSettings>('/api/settings/commerce'),
    ])
      .then(([bp, cs]) => {
        setProfile(bp.profile)
        setAccount(bp.account)
        setCommerce(cs)
      })
      .catch(() => setLoadError('Gagal memuat profil bisnis dari Meta'))
      .finally(() => setLoading(false))
  }, [])

  function updateField<K extends keyof BusinessProfile>(key: K, value: BusinessProfile[K]) {
    setProfile((prev) => (prev ? { ...prev, [key]: value } : prev))
    setSaved(false)
  }

  async function saveProfile() {
    if (!profile) return
    setSaving(true)
    setSaveError(null)
    setSaved(false)
    try {
      const res = await fetch('/api/settings/business-profile', {
        method: 'PATCH',
        body: JSON.stringify({
          about: profile.about ?? '',
          address: profile.address ?? '',
          description: profile.description ?? '',
          email: profile.email ?? '',
          vertical: profile.vertical ?? undefined,
          websites: profile.websites.filter((w) => w.trim() !== ''),
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setSaveError(data?.error ?? 'Gagal menyimpan profil bisnis')
        return
      }
      const data = await res.json()
      setProfile(data.profile)
      setSaved(true)
    } catch {
      setSaveError('Gagal menyimpan profil bisnis')
    } finally {
      setSaving(false)
    }
  }

  async function toggleCommerce(key: keyof CommerceSettings) {
    if (!commerce) return
    setCommerceSaving(true)
    setCommerceError(null)
    try {
      const next = { [key]: !commerce[key] }
      const res = await fetch('/api/settings/commerce', { method: 'PATCH', body: JSON.stringify(next) })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setCommerceError(data?.error ?? 'Gagal menyimpan pengaturan commerce')
        return
      }
      setCommerce(await res.json())
    } catch {
      setCommerceError('Gagal menyimpan pengaturan commerce')
    } finally {
      setCommerceSaving(false)
    }
  }

  return (
    <main className="mx-auto w-full max-w-[1400px] p-6" aria-busy={loading}>
      <PageHeader
        backHref="/settings"
        backLabel="Kembali ke Pengaturan"
        title="Profil Bisnis WhatsApp"
        description="Info yang dilihat pelanggan di profil WhatsApp bisnis, status akun, dan sakelar commerce. Semuanya dibaca dan ditulis langsung ke Meta."
      />

      {loading && (
        <div className="mt-8 flex flex-col gap-8">
          <Skeleton className="h-5 w-56" />
          <SkeletonText lines={5} />
          <SkeletonText lines={3} />
        </div>
      )}
      {loadError && <FieldError className="mt-4 text-sm">{loadError}</FieldError>}

      {/* Status akun membentang penuh — ia cuma dua lencana. Info bisnis dan Commerce
          berdampingan: keduanya formulir pendek yang tidak butuh 1300px sendirian. */}
      <div className="mt-6 grid gap-4 xl:grid-cols-2 xl:items-start">
        {account && (
          <FormSection
            className="xl:col-span-2"
            title={account.name ?? 'Akun WhatsApp Business'}
            description="Status akun menurut Meta. Hanya bisa diubah dari Meta Business Manager, bukan dari sini."
          >
            <div className="flex flex-wrap items-center gap-2">
              {account.accountReviewStatus && (
                <Badge variant={REVIEW_STATUS_VARIANT[account.accountReviewStatus] ?? 'muted'}>
                  Review: {account.accountReviewStatus}
                </Badge>
              )}
              {account.businessVerificationStatus && (
                <Badge variant="muted">Verifikasi: {account.businessVerificationStatus}</Badge>
              )}
            </div>
          </FormSection>
        )}

        {profile && (
          <FormSection
            title="Info bisnis"
            description="Teks ini muncul di halaman profil bisnis yang dibuka pelanggan dari dalam chat."
          >
            <div className="space-y-4">
              <Field label="About (maks. 139 karakter)" htmlFor="bp-about">
                <Input
                  id="bp-about"
                  value={profile.about ?? ''}
                  maxLength={139}
                  onChange={(e) => updateField('about', e.target.value)}
                />
              </Field>
              <Field label="Deskripsi" htmlFor="bp-description">
                <Input
                  id="bp-description"
                  value={profile.description ?? ''}
                  maxLength={256}
                  onChange={(e) => updateField('description', e.target.value)}
                />
              </Field>
              <Field label="Alamat" htmlFor="bp-address">
                <Input
                  id="bp-address"
                  value={profile.address ?? ''}
                  maxLength={256}
                  onChange={(e) => updateField('address', e.target.value)}
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Email" htmlFor="bp-email">
                  <Input
                    id="bp-email"
                    value={profile.email ?? ''}
                    maxLength={128}
                    onChange={(e) => updateField('email', e.target.value)}
                  />
                </Field>
                <Field label="Website" htmlFor="bp-website">
                  <Input
                    id="bp-website"
                    value={profile.websites[0] ?? ''}
                    onChange={(e) => updateField('websites', [e.target.value, ...profile.websites.slice(1)])}
                  />
                </Field>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Button type="button" onClick={saveProfile} disabled={saving}>
                  {saving ? 'Menyimpan...' : 'Simpan profil bisnis'}
                </Button>
                {saved && <p className="text-sm text-success">Profil bisnis tersimpan.</p>}
              </div>
              {saveError && <FieldError className="text-sm">{saveError}</FieldError>}
            </div>
          </FormSection>
        )}

        {commerce && (
          <FormSection
            title="Commerce"
            description="Mengatur apakah pelanggan bisa lihat keranjang belanja dan katalog produk langsung di WhatsApp. Perubahan berlaku begitu kotak dicentang."
          >
            <CommerceRow
              title="Keranjang belanja"
              description="Pelanggan bisa mengumpulkan item katalog jadi satu keranjang lalu mengirimkannya sebagai pesanan."
              ariaLabel="Aktifkan keranjang belanja"
              checked={commerce.isCartEnabled}
              disabled={commerceSaving}
              onToggle={() => toggleCommerce('isCartEnabled')}
            />
            <CommerceRow
              title="Katalog produk terlihat"
              description="Katalog muncul di profil bisnis WhatsApp dan bisa dibuka pelanggan sendiri."
              ariaLabel="Aktifkan katalog produk terlihat"
              checked={commerce.isCatalogVisible}
              disabled={commerceSaving}
              onToggle={() => toggleCommerce('isCatalogVisible')}
            />
            {commerceError && <FieldError className="mt-3 text-sm">{commerceError}</FieldError>}
          </FormSection>
        )}
      </div>
    </main>
  )
}
