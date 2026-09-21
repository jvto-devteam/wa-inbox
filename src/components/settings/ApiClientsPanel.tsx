'use client'
import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, FieldError } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { FormSection } from '@/components/settings/section'
import { fetchJson, FetchJsonError } from '@/lib/fetch-json'

/**
 * API keys for the programs that send system templates (javavolcano-touroperator,
 * new-backoffice). A new key is shown ONCE, right after it is created, and never again — the
 * server keeps only its hash (src/lib/api-clients/auth.ts). Lost key = revoke and create another.
 */
type ApiClient = {
  id: string
  name: string
  keyPrefix: string
  lastUsedAt: string | null
  revokedAt: string | null
  createdAt: string
}

const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : '—'

export function ApiClientsPanel() {
  const [clients, setClients] = useState<ApiClient[] | null>(null)
  const [name, setName] = useState('')
  const [newKey, setNewKey] = useState<{ name: string; key: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchJson<{ items: ApiClient[] }>('/api/api-clients')
      .then(({ items }) => setClients(items))
      .catch((e: unknown) => setError(e instanceof FetchJsonError ? e.message : 'Gagal memuat API client'))
  }, [])

  async function create() {
    setBusy(true)
    setError(null)
    try {
      const created = await fetchJson<ApiClient & { key: string }>('/api/api-clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const { key, ...client } = created
      setClients((current) => [client, ...(current ?? [])])
      setNewKey({ name: client.name, key })
      setName('')
    } catch (e: unknown) {
      setError(e instanceof FetchJsonError ? e.message : 'Gagal membuat API client')
    } finally {
      setBusy(false)
    }
  }

  async function revoke(client: ApiClient) {
    if (!window.confirm(`Cabut key "${client.name}"? Program yang memakainya langsung berhenti bisa mengirim.`)) return
    setError(null)
    try {
      const revoked = await fetchJson<ApiClient>(`/api/api-clients/${client.id}/revoke`, { method: 'POST' })
      setClients((current) => current?.map((c) => (c.id === revoked.id ? revoked : c)) ?? null)
    } catch (e: unknown) {
      setError(e instanceof FetchJsonError ? e.message : 'Gagal mencabut API client')
    }
  }

  return (
    <FormSection
      title="API client"
      description="Key untuk program lain yang mengirim template sistem lewat POST /api/v1/system-messages. Key hanya ditampilkan sekali saat dibuat."
    >
      <div className="space-y-4">
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (name.trim()) void create()
          }}
        >
          <Field label="Nama program" htmlFor="api-client-name" className="min-w-64 flex-1">
            <Input
              id="api-client-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="javavolcano-touroperator"
              maxLength={80}
            />
          </Field>
          <Button type="submit" disabled={busy || !name.trim()}>
            {busy ? 'Membuat...' : 'Buat key'}
          </Button>
        </form>

        {newKey && (
          <div role="status" className="space-y-1.5 rounded-md border border-warning bg-warning-subtle p-3">
            <p className="text-sm font-medium text-ink">
              Key untuk {newKey.name}. Salin sekarang ke .env program itu — key ini tidak akan ditampilkan lagi.
            </p>
            <code className="block font-mono text-sm break-all text-ink select-all">{newKey.key}</code>
            <Button type="button" variant="outline" size="sm" onClick={() => setNewKey(null)}>
              Sudah saya salin
            </Button>
          </div>
        )}

        {error && <FieldError className="text-sm">{error}</FieldError>}

        {clients && clients.length > 0 && (
          <TableContainer>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nama</TableHead>
                  <TableHead>Key</TableHead>
                  <TableHead>Terakhir dipakai</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {clients.map((client) => (
                  <TableRow key={client.id}>
                    <TableCell>{client.name}</TableCell>
                    <TableCell className="font-mono text-sm text-ink-muted">{client.keyPrefix}…</TableCell>
                    <TableCell className="text-sm text-ink-muted">{formatDate(client.lastUsedAt)}</TableCell>
                    <TableCell>
                      {client.revokedAt ? <Badge variant="muted">Dicabut</Badge> : <Badge variant="success">Aktif</Badge>}
                    </TableCell>
                    <TableCell className="text-right">
                      {!client.revokedAt && (
                        <Button type="button" variant="destructive" size="sm" onClick={() => void revoke(client)}>
                          Cabut
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </div>
    </FormSection>
  )
}
