'use client'
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { PanelSectionTitle } from './ContactPanel'
import { BookingHistoryList } from './BookingHistoryList'
import { fetchJson } from '@/lib/fetch-json'
import { announceSummaryItemsChanged } from '@/lib/summary-items/events'
import { POINT_VALUES } from '@/lib/booking-actions/fields'
import {
  canExecuteField,
  companionFields,
  fieldLabel,
  valueText,
  type BookingActionsResponse,
  type BookingActionView,
  type BookingExecutedView,
  type BookingImpactView,
} from '@/lib/booking-actions/view'

/**
 * Kartu "Permintaan perubahan booking" di panel kanan Inbox. Satu kolom, tombol min-h-11 (44 px).
 * "Setujui" pada CHANGE MENULIS ke backoffice (PATCH op execute, Task 11) dengan nilai di isian
 * "Nilai yang ditulis" (terisi usulan; admin boleh mengoreksi, ruling R14). Nonaktif selama
 * `writeEnabled` false (nilai dari server). Field tanpa jalur tulis (R16) hanya Tolak/Selesai.
 * Kartu titik punya isian detail kedua (R19, terisi dari kartu detail pendamping). Kartu titik <-> detail
 * sisi yang sama ditulis bersama (R17); kartu jam disetujui sendiri (R20).
 *
 * Task 11b: perubahan yang sudah diterapkan (manual atau otomatis) tampil 24 jam (`EXECUTED_VISIBLE_MS`, dari server)
 * dengan tombol "Batalkan" (PATCH op revert, dua langkah karena menulis booking produksi). Terbuka untuk semua yang login.
 */

type Op = 'reject' | 'dismiss' | 'done' | 'not_needed'
const BTN = 'min-h-11 whitespace-normal'
const POINT_FIELDS = ['pickup_point', 'drop_point']

function sourceHref(conversationId: string, messageId: string | null): string {
  const q = new URLSearchParams({ conversation: conversationId })
  if (messageId) q.set('message', messageId)
  return `/inbox?${q.toString()}`
}

function ImpactLines({ impact }: { impact: BookingImpactView }) {
  if (impact.unavailable) return <p className="text-sm text-warning">Dampak tidak bisa dihitung</p>
  const lines: string[] = []
  if (impact.crewClashes.length > 0) lines.push(`Bentrok crew: ${impact.crewClashes.join(', ')}`)
  if (impact.hotelNights.length > 0) lines.push(`Malam hotel: ${impact.hotelNights.join(', ')}`)
  if (impact.medicalCheckupDate) {
    lines.push(`Medical checkup: ${valueText(impact.medicalCheckupDate.from)} → ${valueText(impact.medicalCheckupDate.to)}`)
  }
  if (lines.length === 0) return <p className="text-sm text-ink-muted">Tidak ada dampak terdeteksi.</p>
  return (
    <ul className="space-y-0.5 text-sm text-ink">
      {lines.map((l) => (
        <li key={l}>{l}</li>
      ))}
    </ul>
  )
}

function proposedText(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function ExecuteControls({
  action,
  companions,
  writeEnabled,
  busy,
  onExecute,
}: {
  action: BookingActionView
  companions: BookingActionView[]
  writeEnabled: boolean
  busy: boolean
  onExecute: (id: string, value: string, detail?: string) => void
}) {
  const isPoint = POINT_FIELDS.includes(action.field)
  // R19: kartu titik membawa detail; terisi dari kartu detail pendamping yang masih terbuka.
  const detailCompanion = isPoint ? companions.find((c) => c.field.endsWith('_detail')) : undefined
  const [value, setValue] = useState(() => proposedText(action.proposedValue))
  const [detail, setDetail] = useState(() => proposedText(detailCompanion?.proposedValue))
  const inputId = `booking-action-value-${action.id}`
  const detailId = `booking-action-detail-${action.id}`
  const disabled = !writeEnabled || busy
  return (
    <>
      <div className="flex flex-col gap-1">
        <label htmlFor={inputId} className="text-xs text-ink-muted">
          Nilai yang ditulis
        </label>
        {isPoint ? (
          <Select id={inputId} className="min-h-11 w-full" value={value} disabled={disabled} onChange={(e) => setValue(e.target.value)}>
            {!(POINT_VALUES as readonly string[]).includes(value) && <option value={value}>{value || '-'}</option>}
            {POINT_VALUES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
        ) : (
          <Input
            id={inputId}
            className="min-h-11"
            value={value}
            disabled={disabled}
            maxLength={300}
            placeholder={action.field === 'tshirt_sizes' ? 'M x 2, L x 1' : undefined}
            onChange={(e) => setValue(e.target.value)}
          />
        )}
      </div>
      {isPoint && (
        <div className="flex flex-col gap-1">
          <label htmlFor={detailId} className="text-xs text-ink-muted">
            Detail (nama hotel / nomor flight / stasiun / lokasi)
          </label>
          <Input id={detailId} className="min-h-11" value={detail} disabled={disabled} maxLength={300} onChange={(e) => setDetail(e.target.value)} />
        </div>
      )}
      {companions.map((c) =>
        c === detailCompanion ? (
          <p key={c.id} className="text-sm text-ink-muted">
            Kartu {fieldLabel(c.field)} ikut ditulis dan ditutup.
          </p>
        ) : (
          <p key={c.id} className="text-sm text-ink-muted">
            Ditulis bersama: {fieldLabel(c.field)} → {valueText(c.proposedValue)}
          </p>
        )
      )}
      <Button
        type="button"
        className={BTN}
        disabled={disabled || !value.trim()}
        onClick={() => onExecute(action.id, value, isPoint && detail.trim() ? detail : undefined)}
      >
        {busy ? 'Menulis…' : 'Setujui'}
      </Button>
      {!writeEnabled && <p className="text-xs text-ink-muted">Aktif setelah sambungan ke my-booking tersedia</p>}
    </>
  )
}

function ActionCard({
  action,
  companions,
  booking,
  writeEnabled,
  busy,
  onOp,
  onExecute,
}: {
  action: BookingActionView
  companions: BookingActionView[]
  booking: BookingActionsResponse['booking']
  writeEnabled: boolean
  busy: boolean
  onOp: (id: string, op: Op) => void
  onExecute: (id: string, value: string, detail?: string) => void
}) {
  const label = fieldLabel(action.field)
  const proposed = valueText(action.proposedValue)
  const old = valueText(action.oldValue)
  const executable = canExecuteField(action.field)
  return (
    <li className="space-y-2 rounded-md border border-line bg-surface p-3 break-words" aria-label={`${action.type}: ${label}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={action.type === 'CHANGE' ? 'warning' : action.type === 'TASK' ? 'brand' : 'muted'}>
          {action.type === 'CHANGE' ? 'Perubahan' : action.type === 'TASK' ? 'Tugas' : 'Tidak sesuai'}
        </Badge>
      </div>
      {booking && (
        <p className="text-xs text-ink-muted">
          {booking.code ?? `#${booking.id}`}
          {booking.start && ` · ${booking.start}${booking.end ? ` – ${booking.end}` : ''}`}
        </p>
      )}

      {action.type === 'CHANGE' && (
        <>
          <p className="text-sm text-ink">
            {label}: {old} → <span className="font-medium">{proposed}</span>
          </p>
          {action.field === 'tshirt_sizes' && <p className="text-sm text-ink-muted">Vendor kaos akan diberi tahu.</p>}
          {action.tier === 'BALI' && <p className="text-sm text-ink-muted">Vendor transport Bali akan diberi tahu.</p>}
          {!executable && <p className="text-sm text-ink-muted">Belum bisa ditulis otomatis. Ubah di backoffice lalu tandai Selesai.</p>}
          {action.lastError && <p className="text-sm text-danger">Gagal terakhir: {action.lastError}</p>}
        </>
      )}
      {action.type === 'MISMATCH' && (
        <p className="text-sm text-ink">
          {label} - Chat: {proposed}
          {action.field === 'total_pax' && ' orang'} · Booking: {old}
        </p>
      )}
      {action.type === 'TASK' && (
        <>
          <p className="text-sm text-ink">
            {label}: {old} → <span className="font-medium">{proposed}</span>
          </p>
          {action.impact && <ImpactLines impact={action.impact} />}
          <p className="text-sm text-ink-muted">Ubah di backoffice. Kartu tertutup sendiri.</p>
        </>
      )}

      {action.sourceMessageId && (
        <Link
          href={sourceHref(action.conversationId, action.sourceMessageId)}
          className="focus-ring inline-block text-sm text-accent hover:underline"
        >
          Lihat pesan sumber
        </Link>
      )}

      <div className="flex flex-col gap-2">
        {action.type === 'CHANGE' && (
          <>
            {executable ? (
              <ExecuteControls
                action={action}
                companions={companions}
                writeEnabled={writeEnabled}
                busy={busy}
                onExecute={onExecute}
              />
            ) : (
              <Button type="button" className={BTN} disabled={busy} onClick={() => onOp(action.id, 'done')}>
                Selesai
              </Button>
            )}
            <Button type="button" variant="outline" className={BTN} disabled={busy} onClick={() => onOp(action.id, 'reject')}>
              Tolak
            </Button>
          </>
        )}
        {action.type === 'MISMATCH' && (
          <Button type="button" variant="outline" className={BTN} disabled={busy} onClick={() => onOp(action.id, 'dismiss')}>
            Chat yang salah
          </Button>
        )}
        {action.type === 'TASK' && (
          <>
            <Button type="button" className={BTN} disabled={busy} onClick={() => onOp(action.id, 'done')}>
              Selesai
            </Button>
            <Button type="button" variant="outline" className={BTN} disabled={busy} onClick={() => onOp(action.id, 'not_needed')}>
              Tidak perlu
            </Button>
          </>
        )}
      </div>
    </li>
  )
}

function ExecutedCard({ item, busy, onRevert }: { item: BookingExecutedView; busy: boolean; onRevert: (id: string) => void }) {
  const [confirming, setConfirming] = useState(false)
  const label = fieldLabel(item.field)
  const auto = item.closedReason === 'AUTO_APPLIED'
  return (
    <li className="space-y-2 rounded-md border border-line bg-surface p-3 break-words" aria-label={`Diterapkan: ${label}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="success">{auto ? 'Diterapkan otomatis' : 'Diterapkan'}</Badge>
      </div>
      <p className="text-sm text-ink">
        {label}: {valueText(item.oldValue)} → <span className="font-medium">{valueText(item.newValue)}</span>
      </p>
      {!item.revertable ? (
        <p className="text-sm text-ink-muted">Ubah di backoffice</p>
      ) : confirming ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-ink-muted">Nilai di booking dikembalikan ke {valueText(item.oldValue)}.</p>
          <Button
            type="button"
            variant="outline"
            className={BTN}
            disabled={busy}
            onClick={() => {
              setConfirming(false)
              onRevert(item.id)
            }}
          >
            {busy ? 'Membatalkan…' : 'Ya, batalkan'}
          </Button>
          <Button type="button" variant="ghost" className={BTN} disabled={busy} onClick={() => setConfirming(false)}>
            Tidak
          </Button>
        </div>
      ) : (
        <Button type="button" variant="outline" className={BTN} disabled={busy} onClick={() => setConfirming(true)}>
          Batalkan
        </Button>
      )}
    </li>
  )
}

/** Kartu CHANGE OPEN lain di sisi yang sama yang ikut ditulis saat kartu ini disetujui (R17). */
function companionsOf(action: BookingActionView, all: BookingActionView[]): BookingActionView[] {
  if (action.type !== 'CHANGE') return []
  const fields = companionFields(action.field) as string[]
  return all.filter((o) => o.id !== action.id && o.type === 'CHANGE' && fields.includes(o.field))
}

export function BookingActionsSection({ conversationId }: { conversationId: string }) {
  const [data, setData] = useState<BookingActionsResponse | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    return fetchJson<BookingActionsResponse>(`/api/conversations/${conversationId}/booking-actions`)
      .then((res) => {
        // Bentuk tak terduga (mis. galat bersambung) tidak boleh merobohkan panel.
        if (res && Array.isArray(res.actions) && Array.isArray(res.history)) setData(res)
      })
      .catch(() => {})
  }, [conversationId])

  useEffect(() => {
    void load()
  }, [load])

  // Jalur SSE yang sama dengan ConversationList/NotificationListener. Tanpa EventSource (jsdom,
  // peramban lama) panel tetap jalan, hanya tidak hidup.
  useEffect(() => {
    if (typeof EventSource === 'undefined') return
    const es = new EventSource('/api/sse')
    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data) as { type?: string; conversationId?: string }
        if (event.type === 'booking-actions.changed' && event.conversationId === conversationId) void load()
      } catch {
        // Event rusak diabaikan.
      }
    }
    return () => es.close()
  }, [conversationId, load])

  async function patch(id: string, body: { op: Op } | { op: 'execute'; value: string; detail?: string } | { op: 'revert' }) {
    setBusyId(id)
    setError(null)
    try {
      await fetchJson<unknown>(`/api/booking-actions/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      announceSummaryItemsChanged()
      await load()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Permintaan gagal')
      await load()
    } finally {
      setBusyId(null)
    }
  }

  if (!data || (data.actions.length === 0 && data.history.length === 0 && (data.executed ?? []).length === 0)) return null

  return (
    <section aria-label="Tindakan booking" className="space-y-2">
      <PanelSectionTitle>Permintaan perubahan booking</PanelSectionTitle>
      {data.actions.length > 0 && (
        <ul className="flex flex-col gap-2">
          {data.actions.map((a) => (
            <ActionCard
              // Kunci memuat usulan (dan usulan detail pendamping): isian koreksi terisi ulang bila berubah.
              key={`${a.id}:${proposedText(a.proposedValue)}:${companionsOf(a, data.actions).map((c) => proposedText(c.proposedValue)).join('|')}`}
              action={a}
              companions={companionsOf(a, data.actions)}
              booking={data.booking}
              writeEnabled={data.writeEnabled}
              busy={busyId !== null && (busyId === a.id || companionsOf(a, data.actions).some((c) => c.id === busyId))}
              onOp={(id, op) => void patch(id, { op })}
              onExecute={(id, value, detail) => void patch(id, detail === undefined ? { op: 'execute', value } : { op: 'execute', value, detail })}
            />
          ))}
        </ul>
      )}
      {(data.executed ?? []).length > 0 && (
        <ul aria-label="Perubahan yang sudah diterapkan" className="flex flex-col gap-2">
          {(data.executed ?? []).map((x) => (
            <ExecutedCard key={x.id} item={x} busy={busyId === x.id} onRevert={(id) => void patch(id, { op: 'revert' })} />
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <BookingHistoryList events={data.history} />
    </section>
  )
}
