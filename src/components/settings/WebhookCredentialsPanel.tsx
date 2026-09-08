'use client'
import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { FormSection } from '@/components/settings/section'
import { fetchJson } from '@/lib/fetch-json'

type CredentialsStatus = { coexistBaseUrl: string; accessTokenSet: boolean; coexistApiKeySet: boolean }

export function WebhookCredentialsPanel() {
  const [status, setStatus] = useState<CredentialsStatus | null>(null)

  // There is no `deployedBaseUrl` concept anywhere in this codebase (no env
  // var in .env.example, no such field on WaNumber/Settings) — the browser
  // that loaded this page already knows the correct public base URL it was
  // served from, so derive it client-side instead of inventing new config
  // that would need to be kept in sync with the real deployment URL. A lazy
  // useState initializer (rather than an effect) computes this exactly once,
  // on this component's first client-side render.
  const [webhookUrl] = useState(() =>
    typeof window === 'undefined' ? '' : `${window.location.origin}/api/webhooks/meta`
  )

  useEffect(() => {
    // The panel renders nothing until `status` lands, so a failure simply keeps it hidden.
    fetchJson<CredentialsStatus>('/api/numbers/credentials')
      .then(setStatus)
      .catch(() => {})
  }, [])

  if (!status) return null

  return (
    <FormSection
      title="Webhook & kredensial"
      description="Alamat yang harus terdaftar di Meta, dan apakah kedua kunci sudah terpasang. Nilai kuncinya sendiri tidak pernah ditampilkan di sini."
    >
      <dl className="space-y-3">
        <div className="space-y-0.5">
          <dt className="text-sm font-medium text-ink">Meta webhook URL</dt>
          <dd className="font-mono text-sm break-all text-ink-muted">{webhookUrl}</dd>
        </div>
        <div className="space-y-0.5">
          <dt className="text-sm font-medium text-ink">wa-coexist base URL</dt>
          <dd className="font-mono text-sm break-all text-ink-muted">{status.coexistBaseUrl}</dd>
        </div>
      </dl>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Badge variant={status.accessTokenSet ? 'success' : 'destructive'}>
          Access token: {status.accessTokenSet ? 'Diset' : 'Belum diset'}
        </Badge>
        <Badge variant={status.coexistApiKeySet ? 'success' : 'destructive'}>
          Coexist API key: {status.coexistApiKeySet ? 'Diset' : 'Belum diset'}
        </Badge>
      </div>
    </FormSection>
  )
}
