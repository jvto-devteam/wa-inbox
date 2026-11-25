'use client'

// Menu Antrean, DATA ASLI: item terbuka dari GET /api/summary-items (antrean yang sama dengan /summary) dan reminder
// kontak dari GET /api/new/reminders; olahan di src/lib/new/antrean.ts. Aksi memakai route yang sudah ada, tidak ada
// yang mengirim pesan ke tamu: Ingatkan = POST /api/summary-items/[id]/schedule (membuat reminder), Lepas = .../drop,
// Tunda = schedule ulang (item) atau PATCH /api/contacts/[id]/reminders { dueAt }, Selesai = PATCH { done: true }.
// Tab "Follow-up agent" dibuang: jadwal reminder agent dikirim backoffice, belum ada datanya di sini.
import type { SummaryItemsResponse } from '@/app/api/summary-items/route'
import type { NewReminder } from '@/app/api/new/reminders/route'
import { jakartaDay } from '@/lib/bot/eval/replay-pairs'
import { buildQueue, type QueueItem } from '@/lib/new/antrean'
import { whenLabel } from '@/lib/new/dates'
import { ALBL, AT_KEYS, FUT } from '@/lib/new/mock-data'
import { addDays } from '@/lib/new/report'
import type { AtKey } from '@/lib/new/types'
import { SegBar } from '../Blocks'
import { useItemTap, useNew, type SheetItem } from '../store'
import { apiSend, useApi } from '../useApi'

type Css = React.CSSProperties & Record<`--${string}`, string>
/** Warna jenis antrean: slot kategorikal tetap (sama dengan Dashboard). */
const TAB_COLOR: Record<AtKey, string> = { Balas: 'var(--s1)', 'Tindak lanjut': 'var(--s2)', 'Janji tim': 'var(--s3)', Reminder: 'var(--s4)' }

/** Pilihan pemilih waktu (hari ke-off dari hari ini WIB, jam) → ISO. */
function dueIso(off: number, tm: string): string {
  return new Date(addDays(jakartaDay(new Date()), off) + 'T' + tm + ':00+07:00').toISOString()
}

export function AntreanView() {
  const st = useNew()
  const { s, set, toast } = st
  const tap = useItemTap()
  const itemsApi = useApi<SummaryItemsResponse>('/api/summary-items')
  const remApi = useApi<{ reminders: NewReminder[] }>('/api/new/reminders')
  const Q = buildQueue(itemsApi.data, remApi.data?.reminders, new Date())
  const loading = itemsApi.loading || remApi.loading
  const error = itemsApi.error || remApi.error
  const reload = () => { itemsApi.reload(); remApi.reload() }
  // Tautan lama ke tab Follow-up agent (Dashboard) jatuh ke Balas.
  const tab: AtKey = s.atab === FUT ? 'Balas' : s.atab
  const fail = (e: unknown) => toast(e instanceof Error ? e.message : 'Gagal')
  const go = (href: string | null) => { if (href) window.location.assign(href) }

  const ingatkan = (x: QueueItem) => {
    if (!x.itemId) return
    const id = x.itemId
    st.remind({
      name: x.name,
      onDone: (off, tm) => {
        apiSend('/api/summary-items/' + id + '/schedule', 'POST', { dueAt: dueIso(off, tm), note: (x.saran || x.text || 'Tindak lanjut chat ' + x.name).slice(0, 500) })
          .then(() => { toast('Dijadwalkan ' + whenLabel(off, tm).toLowerCase() + '. Ada di tab Reminder'); reload() })
          .catch(fail)
      },
    })
  }
  const tunda = (x: QueueItem) => {
    const rm = x.reminder
    if (!rm) return
    st.remind({
      name: x.name,
      onDone: (off, tm) => {
        const dueAt = dueIso(off, tm)
        const req = x.itemId
          ? apiSend('/api/summary-items/' + x.itemId + '/schedule', 'POST', { dueAt, note: rm.note.slice(0, 500) })
          : apiSend('/api/contacts/' + rm.contactId + '/reminders', 'PATCH', { reminderId: rm.id, dueAt })
        req.then(() => { toast('Reminder ditunda ke ' + whenLabel(off, tm).toLowerCase()); reload() }).catch(fail)
      },
    })
  }
  const selesai = (x: QueueItem) => {
    const rm = x.reminder
    if (!rm) return
    apiSend('/api/contacts/' + rm.contactId + '/reminders', 'PATCH', { reminderId: rm.id, done: true })
      .then(() => { toast('Reminder selesai'); reload() })
      .catch(fail)
  }
  const lepas = (x: QueueItem) => {
    if (!x.itemId) return
    const id = x.itemId
    st.sheet('Lepas ' + x.name + ' dari antrean?', [{
      label: 'Lepas', danger: true,
      run: () => { apiSend('/api/summary-items/' + id + '/drop', 'POST', {}).then(() => { toast('Dilepas dari antrean'); reload() }).catch(fail) },
    }])
  }
  const actsOf = (x: QueueItem, k: AtKey): SheetItem[] => [
    ...(x.href ? [{ label: k === 'Balas' ? 'Balas di chat' : 'Buka chat', run: () => go(x.href) }] : []),
    ...(k === 'Reminder'
      ? [{ label: 'Tunda', run: () => tunda(x) }, { label: 'Selesai', run: () => selesai(x) }]
      : [{ label: 'Ingatkan', run: () => ingatkan(x) }, { label: 'Lepas', danger: true, run: () => lepas(x) }]),
  ]

  const tot = AT_KEYS.reduce((n, k) => n + Q[k].length, 0)
  // Paling mendesak = item tertua Balas (lalu Follow Up, Janji); "berikutnya" = sisa jenis itu.
  const topK = (['Balas', 'Tindak lanjut', 'Janji tim'] as AtKey[]).find((k) => Q[k].length)
  const top = topK ? Q[topK][0] : null
  const next = topK ? Q[topK].slice(1, 4) : []
  const list = Q[tab]

  return (
    <section className="view fx" id="v-antrean">
      {error && <div className="card" style={{ color: 'var(--bad)', marginBottom: 12 }}>{error}</div>}
      {loading && !itemsApi.data ? (
        <div className="pg-urgent"><div><div className="k">Antrean</div><div className="n">Memuat…</div></div></div>
      ) : top && topK ? (
        <div className="pg-urgent">
          <div style={{ minWidth: 0 }}>
            <div className="k">Paling mendesak · {topK === 'Balas' ? 'Belum dibalas' : (ALBL[topK] || topK)}</div>
            <div className="n">{top.name} <span className={'pill ' + (top.overdue ? 'bad' : 'warn')}>{top.when}</span></div>
            <p>{top.text}</p>
            {top.saran && <div className="saran"><span className="saran-k">Saran tindakan</span><span className="saran-t">{top.saran}</span></div>}
          </div>
          <div className="acts">
            {top.href && <a className="btn pri sm" href={top.href}>{topK === 'Balas' ? 'Balas sekarang' : 'Buka chat'}</a>}
            <button className="btn sm" onClick={() => ingatkan(top)}>Ingatkan</button>
          </div>
          {next.length > 0 && (
            <div className="nx">Berikutnya: {next.map((x, i) => (
              <span key={x.key}>{i ? ' · ' : ''}{x.href ? <a href={x.href}>{x.name}</a> : x.name} ({x.when.toLowerCase()})</span>
            ))}</div>
          )}
        </div>
      ) : (
        <div className="pg-urgent" style={{ borderLeftColor: 'var(--good)' }}><div><div className="k" style={{ color: 'var(--good)' }}>Beres</div><div className="n">Tidak ada chat yang menunggu balasan</div></div></div>
      )}

      <div className="pg-card">
        <div className="pg-card-h"><h3>Isi antrean</h3><span className="mut sm">{tot} hal menunggu tim</span></div>
        <SegBar
          id="a-tabs"
          active={tab}
          onPick={(k) => set((d) => { d.atab = k as AtKey })}
          items={AT_KEYS.map((k) => ({ key: k, label: ALBL[k] || k, n: Q[k].length, color: TAB_COLOR[k] }))}
        />
      </div>

      <div className="card" id="a-list">
        {loading && !itemsApi.data ? <div className="mut" style={{ padding: 20, textAlign: 'center' }}>Memuat…</div>
          : list.length ? list.map((x) => {
            const items = actsOf(x, tab)
            return (
              <div key={x.key} className="item" style={{ '--ac': TAB_COLOR[tab] } as Css} onClick={tap(x.name, items)}>
                <div style={{ minWidth: 0 }}>
                  <b>{x.name}</b> <span className={'pill ' + (x.overdue ? 'bad' : 'warn')}>{x.when}</span>
                  <p>{x.text}</p>
                  {x.saran && <div className="saran"><span className="saran-k">Saran tindakan</span><span className="saran-t">{x.saran}</span></div>}
                </div>
                <div className="acts">
                  {items.map((b) => <button key={b.label} className={'btn sm' + (b.danger ? ' bad' : '')} onClick={b.run}>{b.label}</button>)}
                </div>
              </div>
            )
          }) : <div className="mut" style={{ padding: 20, textAlign: 'center' }}>Antrean ini kosong. Semua tertangani.</div>}
      </div>
    </section>
  )
}
