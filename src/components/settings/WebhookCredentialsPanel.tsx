'use client'
import { useEffect, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
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
    <Card className="space-y-3 p-4">
      <h2 className="font-medium text-navy">Webhook & kredensial</h2>

      <div className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Meta webhook URL</p>
        <p className="break-all text-sm text-navy">{webhookUrl}</p>
      </div>

      <div className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">wa-coexist base URL</p>
        <p className="break-all text-sm text-navy">{status.coexistBaseUrl}</p>
      </div>

      <div className="flex items-center gap-3">
        <Badge variant={status.accessTokenSet ? 'success' : 'destructive'}>
          Access token: {status.accessTokenSet ? 'Diset' : 'Belum diset'}
        </Badge>
        <Badge variant={status.coexistApiKeySet ? 'success' : 'destructive'}>
          Coexist API key: {status.coexistApiKeySet ? 'Diset' : 'Belum diset'}
        </Badge>
      </div>
    </Card>
  )
}
