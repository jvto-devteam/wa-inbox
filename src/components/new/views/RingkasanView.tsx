'use client'

// Ringkasan harian, DATA ASLI (GET /api/daily-summary, rute yang sama dengan /summary; olahan di
// src/lib/new/summary.ts). Pola sama dengan Antrean: kartu sorotan (komplain / janji terbuka), satu
// kartu kendali (hari, Poin vs Per percakapan, sebaran jenis sebagai saringan), lalu daftar sederhana.
// "Buat ulang" = POST /api/daily-summary/generate, hanya admin.
import { useState } from 'react'
import type { DailySummaryResponse } from '@/app/api/daily-summary/route'
import { isDateKey, previousJakartaDayKey } from '@/lib/daily-summary/time'
import { MONS } from '@/lib/new/dates'
import { KC, POINT_KINDS } from '@/lib/new/mock-data'
import { chatHref, summaryDay } from '@/lib/new/summary'
import type { PointKind } from '@/lib/new/types'
import { SegBar } from '../Blocks'
import { apiSend, useApi, useIsAdmin } from '../useApi'
import { useItemTap, useNew } from '../store'

/** Warna jenis poin mengikuti nada pill-nya (komplain merah, bayar kuning, jemput aksen); sisanya netral, dibedakan label. */
const KIND_COLOR: Record<PointKind, string> = { komplain: 'var(--bad)', bayar: 'var(--warn)', jemput: 'var(--accent)', keputusan: 'var(--muted)', lokasi: 'var(--muted)', trip: 'var(--muted)', kebutuhan: 'var(--muted)' }
const STATUS_NOTE: Record<string, string> = { PARTIAL: 'sebagian percakapan gagal diringkas', RUNNING: 'sedang dibuat', FAILED: 'gagal dibuat' }

function dayLabel(ymd: string): string {
  const [, m, d] = ymd.split('-').map(Number)
  const tgl = d + ' ' + MONS[m - 1]
  return ymd === previousJakartaDayKey(new Date()) ? 'Kemarin · ' + tgl : tgl
}

function hhmm(iso: string): string {
  return new Date(iso).toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
}

export function RingkasanView() {
  const st = useNew()
  const { s, set, toast } = st
  const tap = useItemTap()
  const admin = useIsAdmin()
  const [busy, setBusy] = useState(false)
  // rday berisi YYYY-MM-DD; nilai lain (mis. "Hari ini" dari Dashboard) = ringkasan terbaru.
  const day = isDateKey(s.rday) ? s.rday : null
  const api = useApi<DailySummaryResponse>('/api/daily-summary' + (day ? '?date=' + day : ''))
  const D = api.data ? summaryDay(api.data) : null
  const P = D?.points ?? []
  const kom = P.filter((x) => x.kind === 'komplain')
  const kinds = ['Semua', ...POINT_KINDS.filter((k) => P.some((x) => x.kind === k))]
  const rkind = kinds.includes(s.rkind) ? s.rkind : 'Semua'
  const nConv = new Set(P.map((x) => x.conversationId)).size
  const L = P.filter((x) => rkind === 'Semua' || x.kind === rkind)
  const chats = D?.chats ?? []
  const openN = chats.filter((c) => c.open).length
  const setDay = (v: string) => set((d) => { d.rday = v; d.rkind = 'Semua' })
  const regen = async () => {
    if (!D || busy) return
    setBusy(true)
    toast('Membuat ulang ringkasan ' + dayLabel(D.date) + ', bisa beberapa menit…')
    try {
      await apiSend('/api/daily-summary/generate', 'POST', { date: D.date })
      toast('Ringkasan dibuat ulang')
      api.reload()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Gagal membuat ulang ringkasan')
    } finally {
      setBusy(false)
    }
  }
  const meta = D
    ? D.active + ' percakapan aktif' + (D.finishedAt ? ' · dibuat ' + hhmm(D.finishedAt) : '') + (STATUS_NOTE[D.status] ? ' · ' + STATUS_NOTE[D.status] : '')
    : api.loading ? 'Memuat ringkasan…' : 'Belum ada ringkasan'

  return (
    <section className="view fx" id="v-ringkasan">
      {api.error && <div className="card" style={{ color: 'var(--bad)', marginBottom: 12 }}>{api.error}</div>}
      {D && (kom.length ? (
        <div className="pg-urgent">
          <div style={{ minWidth: 0 }}>
            <div className="k">Perlu perhatian · komplain{kom.length > 1 ? ' (' + kom.length + ')' : ''}</div>
            <div className="n">{kom[0].name}</div>
            <p>{kom[0].text}</p>
          </div>
          <div className="acts">
            <a className="btn pri sm" href={chatHref(kom[0].conversationId, kom[0].messageId)}>Buka chat</a>
            {kom.length > 1 && <button className="btn sm" onClick={() => set((d) => { d.rtab = 'poin'; d.rkind = 'komplain' })}>Semua komplain</button>}
          </div>
          {D.unkept > 0 && <div className="nx">Juga: {D.unkept} janji tim belum ditepati · <a href="/summary">Lihat di Antrean</a></div>}
        </div>
      ) : (
        <div className="pg-urgent" style={{ borderLeftColor: 'var(--good)' }}>
          <div>
            <div className="k" style={{ color: 'var(--good)' }}>Tidak ada komplain</div>
            <div className="n">{D.unkept ? D.unkept + ' janji tim belum ditepati' : 'Semua janji tim sudah ditepati'}</div>
          </div>
          {D.unkept > 0 && <div className="acts"><a className="btn sm" href="/summary">Lihat di Antrean</a></div>}
        </div>
      ))}

      <div className="pg-card" id="r-sum">
        <div className="r-top">
          <select className="sel r-day" id="r-dsel" aria-label="Pilih hari" value={D?.date ?? ''} onChange={(e) => setDay(e.target.value)} disabled={!api.data?.dates.length}>
            {!api.data?.dates.length && <option value="">Belum ada ringkasan</option>}
            {api.data?.dates.map((x) => <option key={x.date} value={x.date}>{dayLabel(x.date)}{STATUS_NOTE[x.status] ? ' (' + STATUS_NOTE[x.status] + ')' : ''}</option>)}
          </select>
          {admin && D && <button className="btn sm r-regen" onClick={regen} disabled={busy}>{busy ? 'Membuat…' : 'Buat ulang'}</button>}
        </div>
        <p className="r-meta">{meta}</p>
        {D?.error && <p className="r-meta" style={{ color: 'var(--bad)' }}>{D.error}</p>}
        <div className="seg r-view" role="group" aria-label="Tampilan ringkasan">
          <button className={s.rtab === 'poin' ? 'on' : ''} aria-pressed={s.rtab === 'poin'} onClick={() => set((d) => { d.rtab = 'poin' })}>Poin penting <b>{P.length}</b></button>
          <button className={s.rtab === 'chat' ? 'on' : ''} aria-pressed={s.rtab === 'chat'} title={openN + ' percakapan perlu tindakan'} onClick={() => set((d) => { d.rtab = 'chat' })}>Per percakapan <b>{openN}</b></button>
        </div>
        {s.rtab === 'poin' && P.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <SegBar
              id="r-chips"
              active={rkind}
              total={{ key: 'Semua', label: 'Semua' }}
              onPick={(k) => set((d) => { d.rkind = k })}
              items={kinds.filter((k) => k !== 'Semua').map((k) => ({ key: k, label: k, n: P.filter((x) => x.kind === k).length, color: KIND_COLOR[k as PointKind] }))}
            />
          </div>
        )}
      </div>

      {s.rtab === 'poin' ? (
        <div className="card" id="r-pts">
          {api.loading ? <div className="mut" style={{ padding: 20, textAlign: 'center' }}>Memuat…</div>
            : !P.length ? <div className="mut" style={{ padding: 20, textAlign: 'center' }}>Tidak ada poin penting pada tanggal ini.</div>
            : L.map((x, i) => {
              const href = chatHref(x.conversationId, x.messageId)
              return (
                <div key={i} className="item" style={{ '--ac': x.kind ? KIND_COLOR[x.kind] : 'var(--muted)' } as React.CSSProperties} onClick={tap(x.name, [{ label: 'Buka chat', run: () => { window.location.href = href } }])}>
                  <div><b>{x.name}</b> {x.kind && <span className={'pill ' + KC[x.kind]}>{x.kind}</span>}<p>{x.text}</p></div>
                  <a className="btn sm" href={href}>Buka chat</a>
                </div>
              )
            })}
          {P.length > 0 && <p className="hint" style={{ margin: '8px 0 0' }}>{L.length} poin dari {nConv} percakapan</p>}
        </div>
      ) : (
        <div className="card" id="r-chats">
          {api.loading ? <div className="mut" style={{ padding: 20, textAlign: 'center' }}>Memuat…</div>
            : !chats.length ? <div className="mut" style={{ padding: 20, textAlign: 'center' }}>Tidak ada percakapan yang diringkas pada tanggal ini.</div>
            : chats.map((c) => (
              <details key={c.conversationId} className="feat" style={{ margin: '0 0 8px' }} open={c.open}>
                <summary><b>{c.name}</b><span className={'pill ' + (c.open ? 'warn' : 'good')} style={{ marginLeft: 'auto' }}>{c.open ? 'Perlu tindakan' : 'Selesai'}</span></summary>
                <div style={{ padding: '0 14px 12px' }}>
                  {c.lines.map((x, i) => <div key={i} style={{ padding: '2px 0' }}>{x}</div>)}
                  <a className="btn sm" style={{ marginTop: 8 }} href={chatHref(c.conversationId)}>Buka chat</a>
                </div>
              </details>
            ))}
        </div>
      )}
      {admin && D && (
        <button className="rfab" aria-label="Buat ulang ringkasan" disabled={busy} onClick={() => st.sheet('Buat ulang ringkasan?', [{ label: 'Buat ulang', run: () => { void regen() } }])}>
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" />
          </svg>
        </button>
      )}
    </section>
  )
}
