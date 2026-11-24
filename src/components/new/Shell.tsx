'use client'

// Cangkang pratinjau /new: sidebar, bar atas, tab bar ponsel, dan semua overlay.
// Port dari artifact "New WA Inbox"; seluruh data adalah data contoh (lib/new/mock-data).
import { usePathname, useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { antreanTotal, failedCount, inboxBadge } from '@/lib/new/logic'
import { CH, KT, initialState } from '@/lib/new/mock-data'
import type { State, ViewKey } from '@/lib/new/types'
import { NAV_ICON, SearchIcon } from './icons'
import { ActionSheet, RangePicker, RemPicker } from './Overlays'
import {
  ROUTES, StoreCtx, TITLES, viewFromPath,
  type DayKey, type NewStore, type RemReq, type SheetItem,
} from './store'

const MQ = '(max-width:860px)'
function subscribeMq(cb: () => void) {
  const m = window.matchMedia(MQ)
  m.addEventListener('change', cb)
  return () => m.removeEventListener('change', cb)
}
const noop = () => () => {}

const SIDE: ViewKey[] = ['hub', 'inbox', 'antrean', 'ringkasan', 'laporan', 'agent', 'kontak', 'template', 'bot']
const MTAB: ViewKey[] = ['hub', 'inbox', 'antrean', 'ringkasan']
const MORE: ViewKey[] = ['laporan', 'agent', 'kontak', 'template', 'bot']

interface Hit { t: 'Chat' | 'Kontak'; n: string; s: string }

export function NewShell({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const view = viewFromPath(pathname)
  // Halaman ini memakai jam & lebar layar peramban; dirender hanya di klien supaya tidak
  // ada beda hasil server/klien.
  const mounted = useSyncExternalStore(noop, () => true, () => false)
  const isM = useSyncExternalStore(subscribeMq, () => window.matchMedia(MQ).matches, () => false)

  const [s, setS] = useState<State>(initialState)
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const [col, setCol] = useState({ v: view, c: view === 'inbox' })
  if (col.v !== view) setCol({ v: view, c: view === 'inbox' })
  const [mstate, setMstate] = useState<'list' | 'chat'>('list')
  const [mInfo, setMInfo] = useState(false)
  const [mSearch, setMSearch] = useState(false)
  const [more, setMore] = useState(false)
  const [sheetD, setSheetD] = useState<{ title: string; items: SheetItem[] } | null>(null)
  const [remD, setRemD] = useState<RemReq | null>(null)
  const [drpK, setDrpK] = useState<DayKey | null>(null)
  const [toastM, setToastM] = useState<{ m: string; n: number } | null>(null)
  const [flashReq, setFlashReq] = useState<{ sel: string; text?: string; n: number } | null>(null)
  const [udrop, setUdrop] = useState(false)
  const [out, setOut] = useState(false)
  const [q, setQ] = useState('')
  const [sOpen, setSOpen] = useState(false)
  const [sidx, setSidx] = useState(0)
  const gsRef = useRef<HTMLInputElement>(null)

  const set = useCallback((fn: (d: State) => void) => {
    setS((prev) => { const d = structuredClone(prev); fn(d); return d })
  }, [])

  const toast = useCallback((m: string) => {
    setToastM((p) => ({ m, n: (p?.n || 0) + 1 }))
  }, [])
  useEffect(() => {
    if (!toastM) return
    const h = setTimeout(() => setToastM(null), 2200)
    return () => clearTimeout(h)
  }, [toastM])

  const closeAll = useCallback(() => { setMore(false); setSheetD(null); setMInfo(false) }, [])

  const go = useCallback((v: ViewKey) => {
    closeAll()
    if (v === 'inbox') setMstate('list')
    if (ROUTES[v] !== pathname) router.push(ROUTES[v])
    window.scrollTo(0, 0)
  }, [closeAll, pathname, router])

  const openConv = useCallback((n: string) => {
    const c = s.cv.find((x) => x.n === n)
    if (!c) { toast('Belum ada percakapan dengan ' + n); return false }
    set((d) => { d.icv = c.id; d.ifl = 'Semua'; d.itab = 'Booking'; const x = d.cv.find((y) => y.id === c.id); if (x) x.un = 0 })
    go('inbox')
    if (isM) setMstate('chat')
    return true
  }, [s.cv, set, go, isM, toast])

  const store: NewStore = useMemo(() => ({
    s, set, view, isM, mstate, go, toast, openConv,
    flash: (sel, text) => setFlashReq((p) => ({ sel, text, n: (p?.n || 0) + 1 })),
    sheet: (title, items) => setSheetD({ title, items }),
    remind: (req) => setRemD(req),
    pickRange: (k) => setDrpK(k),
    setChatMode: (m) => { setMstate(m); if (m !== 'chat') setMInfo(false) },
    toggleInfo: (on) => setMInfo((p) => (on === undefined ? !p : on)),
  }), [s, set, view, isM, mstate, go, toast, openConv])

  // Sorot hasil "Cek" setelah halaman tujuan tergambar.
  useEffect(() => {
    if (!flashReq) return
    const h = setTimeout(() => {
      const els = Array.from(document.querySelectorAll<HTMLElement>('.nwa ' + flashReq.sel))
      const el = els.find((x) => !flashReq.text || (x.textContent || '').includes(flashReq.text))
      if (!el) { toast('Hasilnya sudah tidak ada di halaman tujuan'); return }
      el.classList.add('flash')
      el.scrollIntoView?.({ block: 'center' })
      setTimeout(() => el.classList.remove('flash'), 3500)
    }, 120)
    return () => clearTimeout(h)
  }, [flashReq, toast])

  // ⌘K dan Escape global.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); gsRef.current?.focus() }
      if (e.key === 'Escape') {
        setUdrop(false); setMSearch(false); setMInfo(false); setMore(false); setSheetD(null); setDrpK(null); setRemD(null)
      }
    }
    const onClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      if (!t.closest('.swrap')) setSOpen(false)
      if (!t.closest('#umenu')) setUdrop(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('click', onClick)
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('click', onClick) }
  }, [])

  const hits: Hit[] = useMemo(() => {
    const k = q.trim().toLowerCase()
    if (!k) return []
    const R: Hit[] = []
    for (const c of s.cv) if ((c.n + ' ' + c.bk.kode + ' ' + c.last).toLowerCase().includes(k)) R.push({ t: 'Chat', n: c.n, s: CH[c.ch][0] + ' · ' + c.bk.kode + ' · ' + c.last })
    for (const r of KT) if (!s.cv.some((c) => c.n === r.n) && (r.n + ' ' + r.kode).toLowerCase().includes(k)) R.push({ t: 'Kontak', n: r.n, s: r.ch + ' · ' + r.lab })
    return R
  }, [q, s.cv])
  const sel = Math.min(sidx, Math.max(hits.length - 1, 0))

  const pick = (r: Hit | undefined) => {
    if (!r) return
    setMSearch(false); setSOpen(false); setQ(''); (document.activeElement as HTMLElement | null)?.blur()
    if (r.t === 'Chat') openConv(r.n)
    else { set((d) => { d.kq = r.n }); go('kontak') }
  }

  const badges: Partial<Record<ViewKey, number>> = {
    inbox: inboxBadge(s.cv),
    antrean: antreanTotal(s),
    agent: failedCount(s.ae),
  }

  const rootCls = ['nwa',
    col.c && !isM ? 'collapsed' : '',
    view === 'inbox' ? 'v-inbox' : '',
    view === 'ringkasan' ? 'v-ringkasan' : '',
    isM && view === 'inbox' && mstate === 'chat' ? 'm-inchat' : '',
    isM && mInfo ? 'm-info' : '',
    isM && mSearch ? 'm-search' : '',
  ].filter(Boolean).join(' ')

  if (!mounted) return <div className="nwa" />

  return (
    <StoreCtx.Provider value={store}>
      <div className={rootCls} data-theme={theme}>
        <div className="app anim">
          <aside className="side" id="side">
            <div className="brand"><div className="logo">JV</div><div><b>WA Inbox</b><span>JVTO</span></div></div>
            <div className="nav">
              {SIDE.map((v) => (
                <button key={v} className={view === v ? 'on' : ''} title={TITLES[v]} onClick={() => go(v)}>
                  <svg viewBox="0 0 24 24">{NAV_ICON[v]}</svg>
                  <span className="lbl">{TITLES[v]}</span>
                  {badges[v] !== undefined && (v !== 'agent' || badges[v]! > 0) && (
                    <span className={'bd' + (v === 'inbox' ? '' : ' w')}>{badges[v]}</span>
                  )}
                </button>
              ))}
            </div>
          </aside>
          <main className="main">
            <div className="top">
              <div className="tl">
                <button className="btn sm menu" aria-label="Buka menu" onClick={() => { if (!isM) setCol((p) => ({ ...p, c: !p.c })) }}>☰</button>
                <h1 className="ptitle">{TITLES[view]}</h1>
              </div>
              <div className="swrap">
                <label className="sbox">
                  <SearchIcon />
                  <input ref={gsRef} placeholder="Cari chat, kontak, kode booking" aria-label="Pencarian global" value={q}
                    onChange={(e) => { setQ(e.target.value); setSidx(0); setSOpen(true) }}
                    onFocus={() => setSOpen(true)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); pick(hits[sel]) }
                      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                        e.preventDefault()
                        const n = hits.length
                        if (n) setSidx((sel + (e.key === 'ArrowDown' ? 1 : n - 1)) % n)
                      } else if (e.key === 'Escape') { setQ(''); setSOpen(false) }
                    }} />
                  <kbd>⌘K</kbd>
                </label>
                <button className="mcancel" onClick={() => { setMSearch(false); setQ(''); setSOpen(false) }}>Batal</button>
                {sOpen && q.trim() && (
                  <div className="sres">
                    {hits.length ? hits.map((r, i) => (
                      <button key={r.t + r.n} type="button" className={i === sel ? 'act' : ''} onClick={() => pick(r)}>
                        <span className={'pill ' + (r.t === 'Chat' ? 'info' : 'neu')}>{r.t}</span>
                        <span style={{ minWidth: 0 }}>
                          <b>{r.n}</b>
                          <div className="mut sm" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.s}</div>
                        </span>
                      </button>
                    )) : <div className="mut" style={{ padding: 12 }}>Tidak ditemukan: {q}</div>}
                  </div>
                )}
              </div>
              <div className="attn">
                {s.pause && (
                  <button className="pill bad" onClick={() => { set((d) => { d.btab = 'Agent' }); go('bot') }}>Agent dijeda</button>
                )}
                <button className="mbtn" aria-label="Cari" onClick={() => { setMSearch(true); setTimeout(() => gsRef.current?.focus(), 0) }}>
                  <SearchIcon size={22} />
                </button>
                <button className="btn sm" id="theme" aria-label="Ganti tema" onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}>◐</button>
                <div className="umenu" id="umenu">
                  <button className="ubtn" aria-haspopup="menu" aria-expanded={udrop} aria-label="Menu akun" onClick={() => setUdrop((o) => !o)}>
                    <span className="uav">AD</span><span className="uname">Admin</span>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
                  </button>
                  {udrop && (
                    <div className="udrop" role="menu">
                      <div className="uh"><b>Admin</b><div className="mut sm">Admin · JVTO</div></div>
                      <button role="menuitem" onClick={() => { setUdrop(false); toast('Profil saya dibuka') }}>Profil saya</button>
                      <button role="menuitem" onClick={() => { setUdrop(false); toast('Pengaturan notifikasi dibuka') }}>Notifikasi</button>
                      <button role="menuitem" className="out" onClick={() => { setUdrop(false); setOut(true) }}>Keluar</button>
                    </div>
                  )}
                </div>
              </div>
            </div>
            {children}
          </main>
        </div>

        <div id="toast">{toastM && <div key={toastM.n} className="toast" role="status">{toastM.m}</div>}</div>

        <nav className="mtab" aria-label="Menu utama">
          {MTAB.map((v) => (
            <button key={v} className={view === v ? 'on' : ''} onClick={() => go(v)}>
              <span className="mi">
                <svg viewBox="0 0 24 24" aria-hidden="true">{NAV_ICON[v]}</svg>
                {!!badges[v] && <b className="mbd">{badges[v]}</b>}
              </span>
              <span>{TITLES[v]}</span>
            </button>
          ))}
          <button className={MORE.includes(view) ? 'on' : ''} onClick={() => setMore(true)}>
            <span className="mi">
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.6" fill="currentColor" /><circle cx="12" cy="12" r="1.6" fill="currentColor" /><circle cx="19" cy="12" r="1.6" fill="currentColor" /></svg>
              {!!badges.agent && <b className="mbd">{badges.agent}</b>}
            </span>
            <span>Lainnya</span>
          </button>
        </nav>
        {more && (
          <div className="msheet">
            <div className="mscrim" onClick={() => setMore(false)} />
            <div className="mpanel" role="dialog" aria-label="Menu lainnya">
              <div className="mgrab" />
              {MORE.map((v) => (
                <button key={v} className="mrow" onClick={() => go(v)}>
                  <svg viewBox="0 0 24 24" aria-hidden="true">{NAV_ICON[v]}</svg>
                  {TITLES[v]}
                  {v === 'agent' && !!badges.agent && <b className="mrb">{badges.agent}</b>}
                </button>
              ))}
              <button className="mrow" onClick={() => { setMore(false); setTheme((t) => (t === 'dark' ? 'light' : 'dark')) }}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" /><path d="M12 4v16" /></svg>
                Ganti tema
              </button>
            </div>
          </div>
        )}
        <div className="infoscrim" onClick={() => setMInfo(false)} />

        {sheetD && <ActionSheet title={sheetD.title} items={sheetD.items} onClose={() => setSheetD(null)} />}
        {remD && <RemPicker req={remD} onClose={() => setRemD(null)} />}
        {drpK && (
          <RangePicker
            current={drpK === 'r' ? s.rday : drpK === 'a' ? s.aday : s.sjday}
            onClose={() => setDrpK(null)}
            onApply={(v) => set((d) => {
              if (drpK === 'r') { d.rday = v; d.rkind = 'Semua' }
              else if (drpK === 'a') { d.aday = v; d.aag = 'Semua' }
              else d.sjday = v
            })}
          />
        )}
        {out && (
          <div className="lo">
            <div className="card" style={{ maxWidth: 360, textAlign: 'center' }}>
              <div className="logo" style={{ margin: '0 auto 10px' }}>JV</div>
              <h3>Anda sudah keluar</h3>
              <p className="hint">Masuk lagi untuk membuka inbox.</p>
              <button className="btn pri" onClick={() => { setOut(false); go('inbox'); toast('Selamat datang kembali') }}>Masuk lagi</button>
            </div>
          </div>
        )}
      </div>
    </StoreCtx.Provider>
  )
}

