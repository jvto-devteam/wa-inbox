'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { LabelPicker, type LabelOption } from './LabelPicker'
import { NotesSection } from './NotesSection'
import { BookingActionsSection } from './BookingActionsSection'
import { RemindersSection } from './RemindersSection'
import { ChatReviewTab } from './ChatReviewTab'
import { CrewNoteSection } from './CrewNoteSection'
import { ScheduleNoteSection } from './ScheduleNoteSection'
import { BookingSummary, type BookingData, type TripBrief } from '@/components/contacts/BookingSummary'
import { bookingGuestName, contactDisplayName } from '@/lib/booking/display-name'
import { fetchJson } from '@/lib/fetch-json'
import { PIPELINE_STAGES } from '@/lib/pipeline'
import type { ChannelContact } from '@/lib/channel/contact-channel'

type ContactDetail = {
  botEnabled: boolean
  contactId: string
  contactName: string | null
  avatarUrl: string | null
  source: string | null
  bookingData: BookingData | null
  tripBrief: TripBrief
  labels: LabelOption[]
  pipelineStage: string
}

/**
 * Judul bagian di panel kanan. Satu salinan untuk semua bagian (LabelPicker, NotesSection, RemindersSection, ...);
 * bentuknya judul kotak artifact (`.box h4` di new.css: kecil, kapital, redam).
 */
export function PanelSectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="psec">{children}</h3>
}

type PanelTab = 'booking' | 'ringkasan' | 'kontak'

// Tiga tab panel kanan desain artifact.
const PANEL_TABS: ReadonlyArray<{ value: PanelTab; label: string }> = [
  { value: 'booking', label: 'Booking' },
  { value: 'ringkasan', label: 'Ringkasan' },
  { value: 'kontak', label: 'Kontak' },
]

/**
 * Tab terakhir yang dipilih, per browser. Kenyamanan saja: penyimpanan bisa kosong atau melempar
 * (jendela privat, data situs diblokir), dan panel tetap jalan dengan tab Booking.
 */
const TAB_STORAGE_KEY = 'wa-inbox:inbox-panel-tab'

function readStoredTab(): PanelTab {
  try {
    const v = globalThis.localStorage?.getItem(TAB_STORAGE_KEY)
    return v === 'ringkasan' || v === 'kontak' ? v : 'booking'
  } catch {
    return 'booking'
  }
}

function storeTab(tab: PanelTab) {
  try {
    globalThis.localStorage?.setItem(TAB_STORAGE_KEY, tab)
  } catch {
    // Diabaikan: tab tetap berpindah, hanya tidak diingat.
  }
}

export function ContactPanel({ conversationId }: { conversationId: string }) {
  const [detail, setDetail] = useState<ContactDetail | null>(null)
  const [allLabels, setAllLabels] = useState<LabelOption[]>([])
  const [pipelineError, setPipelineError] = useState<string | null>(null)
  const [channel, setChannel] = useState<ChannelContact | null>(null)
  // Dibaca saat mount aman dari beda hidrasi: selama detail belum termuat (render pertama, juga di server) tidak ada tab
  // yang ditandai terpilih -- lihat `shown` di bawah.
  const [tab, setTab] = useState<PanelTab>(readStoredTab)

  function selectTab(next: PanelTab) {
    setTab(next)
    storeTab(next)
  }

  useEffect(() => {
    fetchJson<ContactDetail>(`/api/conversations/${conversationId}`).then(setDetail).catch(() => {})
    fetchJson<LabelOption[]>('/api/labels').then(setAllLabels).catch(() => {})
    // Terpisah dari detail: untuk IG/FB endpoint ini bisa memanggil Graph API, dan panel tidak
    // boleh menunggunya. Gagal = bagian Kontak saja yang tidak tampil.
    fetchJson<{ contact?: ChannelContact | null }>(`/api/conversations/${conversationId}/channel`)
      .then((data) => setChannel(data.contact ?? null))
      .catch(() => {})
  }, [conversationId])

  // Mirrors LabelPicker's pattern: the pipeline stage drives follow-up/triage
  // decisions, so the dropdown must only ever reflect what the server confirmed —
  // no optimistic update. Await the response and only update displayed state on success.
  async function changePipelineStage(stage: string) {
    setPipelineError(null)
    try {
      const res = await fetch(`/api/conversations/${conversationId}/pipeline`, {
        method: 'PATCH',
        body: JSON.stringify({ stage }),
      })
      if (!res.ok) {
        setPipelineError('Gagal mengubah status pipeline')
        return
      }
      const updated = await res.json()
      setDetail((prev) => (prev ? { ...prev, pipelineStage: updated.pipelineStage } : prev))
    } catch {
      setPipelineError('Gagal mengubah status pipeline')
    }
  }

  const shown: PanelTab | null = detail ? tab : null

  return (
    // Kolom ketiga .inbox (desain artifact): tab di atas, isi yang menggulung sendiri (.pan) dari kotak-kotak (.box).
    // Bagian yang dipasang di sini adalah komponen lama; .legacy-skin memberi mereka token warna desain baru.
    <div className="col" role="region" aria-label="Info kontak" aria-busy={detail ? undefined : true}>
      <div className="tabs" id="i-tabs" role="tablist" aria-label="Isi panel kanan" style={{ padding: '0 8px', margin: 0 }}>
        {PANEL_TABS.map(({ value, label }) => {
          const active = shown === value
          return (
            <button
              key={value}
              type="button"
              role="tab"
              id={`contact-panel-tab-${value}`}
              aria-selected={active}
              aria-controls={`contact-panel-tabpanel-${value}`}
              className={active ? 'on' : ''}
              onClick={() => selectTab(value)}
              style={{ background: 'none', border: 0, borderBottom: '2px solid ' + (active ? 'var(--accent)' : 'transparent'), padding: 10, fontWeight: 550, color: active ? 'var(--ink)' : 'var(--muted)' }}
            >
              {label}
            </button>
          )
        })}
      </div>
      <div className="pan" id="i-pan" role="tabpanel" aria-labelledby={`contact-panel-tab-${tab}`}>
        {!detail ? (
          <div className="mut" style={{ padding: 4 }}>Memuat…</div>
        ) : tab === 'booking' ? (
          <>
            <div className="box legacy-skin">
              <BookingSummary bookingData={detail.bookingData} tripBrief={detail.tripBrief} />
            </div>
            <div className="box legacy-skin">
              <BookingActionsSection conversationId={conversationId} />
            </div>
            <div className="box legacy-skin">
              <ScheduleNoteSection conversationId={conversationId} hasBooking={Boolean(detail.bookingData?.id)} />
            </div>
            <div className="box legacy-skin">
              <CrewNoteSection conversationId={conversationId} hasBooking={Boolean(detail.bookingData?.id)} />
            </div>
            <div className="box legacy-skin">
              <RemindersSection contactId={detail.contactId} />
            </div>
            <div className="box legacy-skin">
              <NotesSection contactId={detail.contactId} />
            </div>
          </>
        ) : tab === 'ringkasan' ? (
          <div className="legacy-skin">
            <ChatReviewTab key={conversationId} conversationId={conversationId} contactName={detail.contactName} />
          </div>
        ) : (
          <>
            <div className="box">
              <h4>Kontak</h4>
              <dl className="kv">
                <dt>Nama</dt>
                <dd>{contactDisplayName(detail.contactName, bookingGuestName(detail.bookingData), 'Tanpa nama')}</dd>
                {channel && (
                  // Kontak di platform asal: nomor WA, alamat email, @username IG, atau nama FB -- dengan
                  // tautan ke sana kalau ada. Facebook hanya bisa ditautkan ke percakapan di inbox Page.
                  <>
                    <dt>Kontak</dt>
                    <dd>
                      {channel.href ? (
                        <a href={channel.href} target="_blank" rel="noopener noreferrer" title={channel.linkLabel ?? undefined} style={{ color: 'var(--accent)' }}>
                          {channel.value}
                        </a>
                      ) : (
                        channel.value
                      )}
                    </dd>
                    <dt>Platform</dt>
                    <dd>{channel.platformLabel}</dd>
                  </>
                )}
                {detail.source && (
                  <>
                    <dt>Sumber</dt>
                    <dd>{detail.source}</dd>
                  </>
                )}
                <dt>Consent</dt>
                <dd>Di halaman Kontak</dd>
              </dl>
            </div>
            <div className="box">
              <h4>Tahap pipeline</h4>
              <select className="sel" aria-label="Tahap pipeline" value={detail.pipelineStage} onChange={(e) => changePipelineStage(e.target.value)}>
                {PIPELINE_STAGES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
              {pipelineError && (
                <p role="alert" className="sm" style={{ margin: '6px 0 0', color: 'var(--bad)' }}>
                  {pipelineError}
                </p>
              )}
            </div>
            <div className="box legacy-skin">
              <LabelPicker
                conversationId={conversationId}
                allLabels={allLabels}
                attachedLabels={detail.labels}
                onAttachedChange={(labels) => setDetail((prev) => (prev ? { ...prev, labels } : prev))}
                onAllLabelsChange={setAllLabels}
              />
            </div>
            <Link className="btn sm" href={`/kontak/${encodeURIComponent(detail.contactId)}`} style={{ alignSelf: 'flex-start' }}>
              Buka di Kontak
            </Link>
          </>
        )}
      </div>
    </div>
  )
}
