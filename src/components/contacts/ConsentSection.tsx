'use client'
import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { fetchJson } from '@/lib/fetch-json'

export type Consent = { optOut: boolean; source: string | null; note: string | null; updatedAt: string }

/**
 * Records whether a contact has asked not to receive campaigns.
 *
 * `ContactConsent` had a model, a migration, an index and a reader in the outbound safety guard,
 * and no writer anywhere — so the opt-out branch in `checkOutboundSafety` could never fire. This
 * is the surface that makes it reachable.
 *
 * Three states, not two. A contact with NO row has never been asked, which is different from one
 * who agreed, and showing them the same way would let an operator believe consent was collected
 * when nobody ever collected it.
 */
export function ConsentSection({ contactId }: { contactId: string }) {
  const [consent, setConsent] = useState<Consent | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetchJson<{ consent: Consent | null }>(`/api/contacts/${contactId}/consent`)
      .then((data) => {
        setConsent(data.consent)
        setNote(data.consent?.note ?? '')
      })
      .catch(() => setError('Gagal memuat status consent'))
      .finally(() => setLoaded(true))
  }, [contactId])

  async function save(optOut: boolean) {
    setSaving(true)
    setError(null)
    try {
      const data = await fetchJson<{ consent: Consent }>(`/api/contacts/${contactId}/consent`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ optOut, note: note.trim() || undefined }),
      })
      setConsent(data.consent)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal menyimpan consent')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-ink">Consent campaign</h2>
      <div className="space-y-3 rounded-lg border border-line bg-surface p-3">
        {!loaded ? (
          <div role="status" aria-label="Memuat status consent" className="space-y-2">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-3 w-full" />
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              {consent === null ? (
                <Badge variant="muted">Belum pernah ditanyakan</Badge>
              ) : consent.optOut ? (
                <Badge variant="warning">Opt-out</Badge>
              ) : (
                <Badge variant="success">Boleh menerima campaign</Badge>
              )}
              {consent && (
                <span className="text-xs text-ink-muted">
                  Diperbarui <time dateTime={consent.updatedAt}>{new Date(consent.updatedAt).toLocaleString('id-ID')}</time>
                </span>
              )}
            </div>

            {/* Said plainly, because the difference decides whether a send is blocked or merely
                flagged, and an agent needs to know before they click. */}
            <p className="text-xs text-ink-muted">
              Opt-out memblokir campaign ke kontak ini. Balasan 1:1 tetap dikirim, tetapi diberi peringatan agar
              tidak dipakai untuk promosi.
            </p>

            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Catatan, misal: diminta lewat WhatsApp 7 September"
              aria-label="Catatan consent"
              rows={2}
            />

            {error && <p className="text-xs font-medium text-danger">{error}</p>}

            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" size="sm" disabled={saving} onClick={() => save(true)}>
                Tandai opt-out
              </Button>
              <Button type="button" variant="outline" size="sm" disabled={saving} onClick={() => save(false)}>
                Boleh menerima campaign
              </Button>
            </div>
          </>
        )}
      </div>
    </section>
  )
}
