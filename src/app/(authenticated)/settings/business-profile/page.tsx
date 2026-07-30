'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
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
    <main className="mx-auto max-w-2xl space-y-4 p-6">
      <div className="space-y-1">
        <Link href="/settings" className="text-sm text-brand hover:underline">
          &larr; Kembali ke Pengaturan
        </Link>
        <h1 className="text-xl font-semibold text-navy">Profil Bisnis WhatsApp</h1>
      </div>

      {loading && <p className="text-sm text-muted-foreground">Memuat...</p>}
      {loadError && <p className="text-sm text-destructive">{loadError}</p>}

      {account && (
        <Card className="space-y-2 p-4">
          <h2 className="font-medium text-navy">{account.name ?? 'Akun WhatsApp Business'}</h2>
          <div className="flex flex-wrap items-center gap-1.5">
            {account.accountReviewStatus && (
              <Badge variant={REVIEW_STATUS_VARIANT[account.accountReviewStatus] ?? 'muted'}>
                Review: {account.accountReviewStatus}
              </Badge>
            )}
            {account.businessVerificationStatus && (
              <Badge variant="muted">Verifikasi: {account.businessVerificationStatus}</Badge>
            )}
          </div>
        </Card>
      )}

      {profile && (
        <Card className="space-y-3 p-4">
          <h2 className="font-medium text-navy">Info Bisnis</h2>
          <div className="space-y-1">
            <label htmlFor="bp-about" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              About (maks. 139 karakter)
            </label>
            <Input id="bp-about" value={profile.about ?? ''} maxLength={139} onChange={(e) => updateField('about', e.target.value)} />
          </div>
          <div className="space-y-1">
            <label htmlFor="bp-description" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Deskripsi
            </label>
            <Input
              id="bp-description"
              value={profile.description ?? ''}
              maxLength={256}
              onChange={(e) => updateField('description', e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="bp-address" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Alamat
            </label>
            <Input id="bp-address" value={profile.address ?? ''} maxLength={256} onChange={(e) => updateField('address', e.target.value)} />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <label htmlFor="bp-email" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Email
              </label>
              <Input id="bp-email" value={profile.email ?? ''} maxLength={128} onChange={(e) => updateField('email', e.target.value)} />
            </div>
            <div className="space-y-1">
              <label htmlFor="bp-website" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Website
              </label>
              <Input
                id="bp-website"
                value={profile.websites[0] ?? ''}
                onChange={(e) => updateField('websites', [e.target.value, ...profile.websites.slice(1)])}
              />
            </div>
          </div>

          <Button type="button" onClick={saveProfile} disabled={saving}>
            {saving ? 'Menyimpan...' : 'Simpan Profil'}
          </Button>
          {saveError && <p className="text-xs text-destructive">{saveError}</p>}
          {saved && <p className="text-xs text-emerald-600">Profil bisnis tersimpan.</p>}
        </Card>
      )}

      {commerce && (
        <Card className="space-y-2 p-4">
          <h2 className="font-medium text-navy">Commerce</h2>
          <p className="text-xs text-muted-foreground">
            Mengatur apakah pelanggan bisa lihat keranjang belanja dan katalog produk langsung di WhatsApp.
          </p>
          <label className="flex cursor-pointer items-center justify-between gap-2 rounded-lg border border-border p-2.5">
            <span className="text-sm text-navy">Keranjang Belanja</span>
            <input
              type="checkbox"
              aria-label="Aktifkan keranjang belanja"
              checked={commerce.isCartEnabled}
              disabled={commerceSaving}
              onChange={() => toggleCommerce('isCartEnabled')}
            />
          </label>
          <label className="flex cursor-pointer items-center justify-between gap-2 rounded-lg border border-border p-2.5">
            <span className="text-sm text-navy">Katalog Produk Terlihat</span>
            <input
              type="checkbox"
              aria-label="Aktifkan katalog produk terlihat"
              checked={commerce.isCatalogVisible}
              disabled={commerceSaving}
              onChange={() => toggleCommerce('isCatalogVisible')}
            />
          </label>
          {commerceError && <p className="text-xs text-destructive">{commerceError}</p>}
        </Card>
      )}
    </main>
  )
}
