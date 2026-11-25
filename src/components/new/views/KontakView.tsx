'use client'

// Kontak (DATA ASLI). Daftar: GET /api/contacts (q, stage, page, limit) -- route yang sama dengan
// /contacts. Komposisi memakai tahap pipeline (Baru/Negosiasi/Booked/Lunas/Selesai), karena label
// "tamu/calon tamu/mitra" tidak ada di data. Detail: catatan, reminder, dan consent lewat
// /api/contacts/[id]/*; data booking lengkap tetap di halaman /contacts/[id] (membaca booking ke API
// luar, tidak dipanggil per baris di sini).
import { useEffect, useState } from 'react'
import { initials } from '@/lib/new/logic'
import { PIPELINE_STAGES, STAGE_LABELS } from '@/lib/pipeline'
import { Banner, SegBar } from '../Blocks'
import { NAV_ICON } from '../icons'
import { useNew } from '../store'
import { apiSend, useApi } from '../useApi'

interface Row {
  id: string
  name: string | null
  phone: string | null
  conversationId: string | null
  orderChannel: string | null
  pipelineStage: string
  lastContactAt: string | null
  labels: string[]
}
interface Note { id: string; body: string; authorName: string | null; createdAt: string }
interface Reminder { id: string; dueAt: string; note: string; done: boolean }
interface Consent { optOut: boolean; source: string | null; note: string | null; updatedAt: string }

const LIMIT = 40
const STAGE_COLOR: Record<string, string> = { new: 'var(--muted)', nego: 'var(--s4)', booked: 'var(--s1)', lunas: 'var(--s3)', selesai: 'var(--s2)' }
const STAGE_PILL: Record<string, string> = { new: 'neu', nego: 'warn', booked: 'info', lunas: 'good', selesai: 'neu' }

export function ago(iso: string | null, now = Date.now()): string {
  if (!iso) return '—'
  const m = Math.round((now - Date.parse(iso)) / 60000)
  if (m < 1) return 'baru saja'
  if (m < 60) return m + ' menit lalu'
  const h = Math.round(m / 60)
  if (h < 24) return h + ' jam lalu'
  const d = Math.round(h / 24)
  if (d < 30) return d + ' hari lalu'
  return new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })
}
const fmtPhone = (p: string | null) => (p ? '+' + p.replace(/^\+/, '') : 'tanpa nomor')

/** Jumlah kontak per tahap: satu permintaan kecil (limit=1) per tahap, dibaca dari `total`. */
function useStageCounts(): Record<string, number> | null {
  const [c, setC] = useState<Record<string, number> | null>(null)
  useEffect(() => {
    let alive = true
    const keys = ['', ...PIPELINE_STAGES.map((s) => s.value)]
    Promise.all(keys.map((k) => fetch('/api/contacts?hasPhone=1&limit=1' + (k ? '&stage=' + k : '')).then((r) => (r.ok ? r.json() : null)).catch(() => null)))
      .then((rs) => {
        if (!alive) return
        const out: Record<string, number> = {}
        keys.forEach((k, i) => { const t = rs[i] && typeof rs[i].total === 'number' ? rs[i].total : null; if (t !== null) out[k || 'Semua'] = t })
        setC(out)
      })
    return () => { alive = false }
  }, [])
  return c
}

function KontakDrawer({ row, onClose }: { row: Row; onClose: () => void }) {
  const { toast } = useNew()
  const notes = useApi<Note[]>('/api/contacts/' + row.id + '/notes')
  const rems = useApi<Reminder[]>('/api/contacts/' + row.id + '/reminders')
  const consent = useApi<{ consent: Consent | null }>('/api/contacts/' + row.id + '/consent')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const addNote = async () => {
    if (!note.trim()) return
    setBusy(true)
    try {
      const n = await apiSend<Note>('/api/contacts/' + row.id + '/notes', 'POST', { body: note.trim() })
      notes.setData([n, ...(notes.data ?? [])])
      setNote('')
      toast('Catatan disimpan')
    } catch (e) { toast((e as Error).message) } finally { setBusy(false) }
  }
  const setConsent = async (allowed: boolean) => {
    try {
      const r = await apiSend<{ consent: Consent }>('/api/contacts/' + row.id + '/consent', 'PUT', { optOut: !allowed })
      consent.setData(r)
      toast(allowed ? 'Kontak boleh dihubungi lewat WhatsApp' : 'Kontak tidak mau dihubungi (opt-out)')
    } catch (e) { toast((e as Error).message) }
  }
  const c = consent.data?.consent
  const open = (rems.data ?? []).filter((r) => !r.done)
  return (
    <div className="drawer" role="dialog" aria-label="Detail kontak">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div className="av">{initials(row.name || row.phone || '?')}</div>
        <div style={{ minWidth: 0 }}><b style={{ fontSize: 16 }}>{row.name || fmtPhone(row.phone)}</b><div className="mut sm">{fmtPhone(row.phone)}</div></div>
        <button className="btn sm" style={{ marginLeft: 'auto' }} aria-label="Tutup" onClick={onClose}>✕</button>
      </div>
      <div className="box" style={{ marginTop: 12 }}>
        <h4>Status</h4>
        <dl className="kv">
          <dt>Tahap</dt><dd><span className={'pill ' + (STAGE_PILL[row.pipelineStage] || 'neu')}>{STAGE_LABELS[row.pipelineStage] || row.pipelineStage}</span></dd>
          <dt>Booking</dt><dd>{row.orderChannel || 'Belum ada'}</dd>
          <dt>Label</dt><dd>{row.labels.length ? row.labels.join(', ') : '—'}</dd>
          <dt>Terakhir</dt><dd>{ago(row.lastContactAt)}</dd>
        </dl>
      </div>
      <div className="box" style={{ marginTop: 10 }}>
        <h4>Reminder</h4>
        {rems.loading ? <span className="mut">Memuat…</span> : open.length ? open.map((r) => (
          <div key={r.id} style={{ padding: '3px 0' }}><span className="pill info">{new Date(r.dueAt).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span> {r.note}</div>
        )) : <span className="mut">Belum ada</span>}
      </div>
      <div className="box" style={{ marginTop: 10 }}>
        <h4>Catatan</h4>
        <textarea className="ta" aria-label="Catatan baru" placeholder="Tulis catatan internal" value={note} onChange={(e) => setNote(e.target.value)} />
        <div className="acts" style={{ marginTop: 6 }}><button className="btn sm pri" disabled={!note.trim() || busy} onClick={addNote}>Simpan catatan</button></div>
        {(notes.data ?? []).slice(0, 5).map((n) => (
          <div key={n.id} style={{ borderTop: '1px solid var(--line)', padding: '6px 0', fontSize: 13 }}>
            {n.body}<div className="mut sm">{n.authorName || 'Tim'} · {ago(n.createdAt)}</div>
          </div>
        ))}
      </div>
      <div className="box" style={{ marginTop: 10 }}>
        <h4>Consent</h4>
        <div className="set">
          <div><b>Boleh dihubungi lewat WhatsApp</b><span className="h">{consent.loading ? 'Memuat…' : c ? 'Diperbarui ' + ago(c.updatedAt) : 'Belum pernah ditanyakan'}</span></div>
          <label className="sw"><input type="checkbox" checked={!c?.optOut} disabled={consent.loading} aria-label="Consent" onChange={(e) => setConsent(e.target.checked)} /><i /></label>
        </div>
      </div>
      <div className="acts" style={{ marginTop: 12 }}>
        {row.conversationId && <a className="btn pri" href={'/new/inbox?conversation=' + row.conversationId}>Buka chat</a>}
        <a className="btn" href={'/new/kontak/' + row.id}>Booking & detail lengkap</a>
      </div>
    </div>
  )
}

export function KontakView() {
  const { s, set } = useNew()
  const [q, setQ] = useState(s.kq)
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState<Row | null>(null)
  // Cari menunggu 300 ms sesudah ketikan terakhir supaya tidak satu permintaan per huruf.
  useEffect(() => {
    const h = setTimeout(() => { set((d) => { d.kq = q }); setPage(1) }, 300)
    return () => clearTimeout(h)
  }, [q, set])
  const stage = s.kl
  const url = '/api/contacts?hasPhone=1&limit=' + LIMIT + '&page=' + page + (s.kq ? '&q=' + encodeURIComponent(s.kq) : '') + (stage ? '&stage=' + stage : '')
  const api = useApi<{ rows: Row[]; total: number; page: number; limit: number }>(url)
  const counts = useStageCounts()
  const rows = api.data?.rows ?? []
  const total = api.data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / LIMIT))

  return (
    <section className="view fx" id="v-kontak">
      <Banner
        tone={api.error ? 'off' : 'info'}
        icon={NAV_ICON.kontak}
        title={counts?.Semua !== undefined ? counts.Semua + ' kontak' : 'Kontak'}
        sub={api.error || 'Kontak bernomor WhatsApp. Tahap mengikuti pipeline percakapan (otomatis dari data booking, atau diubah tim).'}
        right={api.error ? <button className="btn sm" onClick={api.reload}>Coba lagi</button> : undefined}
      />
      <div className="pg-card">
        <SegBar
          id="k-hk"
          active={stage || 'Semua'}
          total={{ key: 'Semua', label: 'Semua', n: counts?.Semua }}
          onPick={(k) => { set((d) => { d.kl = k === 'Semua' ? '' : k }); setPage(1) }}
          items={PIPELINE_STAGES.map((p) => ({ key: p.value, label: p.label, n: counts?.[p.value] ?? 0, color: STAGE_COLOR[p.value] }))}
        />
        <input className="in" placeholder="Cari nama atau nomor" aria-label="Cari kontak" style={{ marginTop: 10 }}
          value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <div className="kt-grid" id="k-t">
        {api.loading && !rows.length ? <div className="pg-card mut" style={{ textAlign: 'center' }}>Memuat…</div>
          : rows.length ? rows.map((r) => (
            <div key={r.id + (r.conversationId || '')} className="kt-c" data-k={r.id} role="button" tabIndex={0}
              onClick={() => setOpen(r)} onKeyDown={(e) => { if (e.key === 'Enter') setOpen(r) }}>
              <span className={'av ' + (r.pipelineStage === 'booked' || r.pipelineStage === 'lunas' ? 'info' : r.pipelineStage === 'nego' ? 'warn' : '')}>{initials(r.name || r.phone || '?')}</span>
              <div className="b">
                <b>{r.name || fmtPhone(r.phone)}</b>
                <span className="kt-m">{fmtPhone(r.phone)}{r.orderChannel ? ' · ' + r.orderChannel : ''}</span>
                {r.labels.length > 0 && <span className="kt-m">{r.labels.join(', ')}</span>}
              </div>
              <div className="r">
                <span className={'pill ' + (STAGE_PILL[r.pipelineStage] || 'neu')}>{STAGE_LABELS[r.pipelineStage] || r.pipelineStage}</span>
                {r.lastContactAt && <span className="t">{ago(r.lastContactAt)}</span>}
                {r.conversationId && <a className="btn sm" href={'/new/inbox?conversation=' + r.conversationId} onClick={(e) => e.stopPropagation()} aria-label={'Buka chat ' + (r.name || r.phone)}>Chat</a>}
              </div>
            </div>
          )) : <div className="pg-card mut" style={{ textAlign: 'center' }}>{api.error ? 'Tidak bisa memuat kontak.' : 'Tidak ada kontak.'}</div>}
      </div>
      {pages > 1 && (
        <div className="acts" style={{ justifyContent: 'center', marginTop: 12 }}>
          <button className="btn sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>‹ Sebelumnya</button>
          <span className="mut sm" style={{ alignSelf: 'center' }}>Hal. {page} dari {pages} · {total} kontak</span>
          <button className="btn sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Berikutnya ›</button>
        </div>
      )}
      {open && (
        <div id="k-drawer" onClick={(e) => { if (e.target === e.currentTarget) setOpen(null) }}>
          <KontakDrawer key={open.id} row={open} onClose={() => setOpen(null)} />
        </div>
      )}
    </section>
  )
}
