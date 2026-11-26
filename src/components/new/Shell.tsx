'use client'

// Cangkang /new: sidebar, bar atas, tab bar ponsel, dan semua overlay. Port dari artifact "New WA Inbox".
// DATA ASLI di cangkang: lencana menu (chat belum dibaca, antrean terbuka, agent gagal hari ini), pencarian global
// (GET /api/conversations?q=), nama akun (GET /api/session), dan Keluar (POST /api/auth/logout). State contoh
// (`initialState`) tinggal dipakai halaman yang belum memakai data asli.
import { usePathname, useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { jakartaDay } from '@/lib/bot/eval/replay-pairs'
import { contactDisplayName } from '@/lib/booking/display-name'
import { fetchJson, redirectToLogin } from '@/lib/fetch-json'
import { initialState } from '@/lib/new/mock-data'
import { SUMMARY_ITEMS_CHANGED } from '@/lib/summary-items/events'
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

// Kantor AI (/ai-office) dan Pengaturan (/settings) sengaja tidak di menu (owner 2026-11-26); alamatnya tetap berlaku.
const SIDE: ViewKey[] = ['hub', 'inbox', 'antrean', 'ringkasan', 'laporan', 'agent', 'kontak', 'template', 'bot']
const MTAB: ViewKey[] = ['hub', 'inbox', 'antrean', 'ringkasan']
const MORE: ViewKey[] = ['laporan', 'agent', 'kontak', 'template', 'bot']

interface Hit { id: string; n: string; s: string }

/** Baris GET /api/conversations yang dipakai pencarian. */
interface ConvRow { id: string; contactName: string | null; contactPhone: string | null; bookingGuestName: string | null; lastMessage: string | null; platform: string | null; isTest: boolean }

const PLATFORM: Record<string, string> = { WHATSAPP: 'WhatsApp', INSTAGRAM: 'Instagram', FACEBOOK: 'Messenger', EMAIL: 'Email' }
const COUNT_POLL_MS = 60_000
const MAX_HITS = 8

function initialsOf(name: string): string {
  const w = name.trim().split(/\s+/).filter(Boolean)
  return ((w[0]?.[0] ?? '') + (w[1]?.[0] ?? '')).toUpperCase() || '?'
}

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
  const [me, setMe] = useState<{ name: string; role: string } | null>(null)
  const [loggingOut, setLoggingOut] = useState(false)
  const [counts, setCounts] = useState<{ inbox?: number; antrean?: number; agent?: number }>({})
  const [found, setFound] = useState<{ q: string; hits: Hit[] } | null>(null)
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

  const store: NewStore = useMemo(() => ({
    s, set, view, isM, mstate, go, toast,
    flash: (sel, text) => setFlashReq((p) => ({ sel, text, n: (p?.n || 0) + 1 })),
    sheet: (title, items) => setSheetD({ title, items }),
    remind: (req) => setRemD(req),
    pickRange: (k) => setDrpK(k),
    setChatMode: (m) => { setMstate(m); if (m !== 'chat') setMInfo(false) },
    toggleInfo: (on) => setMInfo((p) => (on === undefined ? !p : on)),
  }), [s, set, view, isM, mstate, go, toast])

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

  // Nama akun dari sesi.
  useEffect(() => {
    fetchJson<{ name?: string; role?: string }>('/api/session')
      .then((b) => setMe({ name: b.name || 'Akun', role: b.role || '' }))
      .catch(() => {})
  }, [])

  // Lencana menu: saat mount, tiap menit, dan seketika saat antrean berubah. Gagal = lencana lama dibiarkan.
  useEffect(() => {
    let cancelled = false
    const num = (v: unknown) => (typeof v === 'number' ? v : undefined)
    const load = () => {
      const from = new Date(jakartaDay(new Date()) + 'T00:00:00+07:00').toISOString()
      const to = new Date().toISOString()
      fetchJson<{ unread?: unknown }>('/api/new/unread').then((b) => { if (!cancelled) setCounts((c) => ({ ...c, inbox: num(b.unread) })) }).catch(() => {})
      fetchJson<{ open?: unknown }>('/api/summary-items/count').then((b) => { if (!cancelled) setCounts((c) => ({ ...c, antrean: num(b.open) })) }).catch(() => {})
      fetchJson<{ items?: { status?: string }[] }>('/api/new/agent-activity?from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to))
        .then((b) => { if (!cancelled) setCounts((c) => ({ ...c, agent: (b.items ?? []).filter((e) => e.status === 'gagal').length })) })
        .catch(() => {})
    }
    load()
    const timer = setInterval(load, COUNT_POLL_MS)
    window.addEventListener(SUMMARY_ITEMS_CHANGED, load)
    return () => { cancelled = true; clearInterval(timer); window.removeEventListener(SUMMARY_ITEMS_CHANGED, load) }
  }, [])

  // Pencarian global: nama, nomor, atau isi chat (GET /api/conversations?q=, sama dengan pencarian Inbox).
  useEffect(() => {
    const k = q.trim()
    if (!k) return
    let cancelled = false
    const h = setTimeout(() => {
      fetchJson<ConvRow[]>('/api/conversations?q=' + encodeURIComponent(k))
        .then((rows) => {
          if (cancelled) return
          const hits = rows.filter((r) => !r.isTest).slice(0, MAX_HITS).map((r): Hit => ({
            id: r.id,
            n: contactDisplayName(r.contactName, r.bookingGuestName, r.contactPhone || 'Tanpa nama'),
            s: [PLATFORM[r.platform ?? ''] ?? 'WhatsApp', r.lastMessage?.replace(/\s+/g, ' ').slice(0, 80)].filter(Boolean).join(' · '),
          }))
          setFound({ q: k, hits })
        })
        .catch(() => { if (!cancelled) setFound({ q: k, hits: [] }) })
    }, 250)
    return () => { cancelled = true; clearTimeout(h) }
  }, [q])
  const hits: Hit[] = found && found.q === q.trim() ? found.hits : []
  const searching = !!q.trim() && found?.q !== q.trim()
  const sel = Math.min(sidx, Math.max(hits.length - 1, 0))

  const pick = (r: Hit | undefined) => {
    if (!r) return
    setMSearch(false); setSOpen(false); setQ(''); (document.activeElement as HTMLElement | null)?.blur()
    closeAll()
    router.push('/inbox?conversation=' + encodeURIComponent(r.id))
  }

  const logout = async () => {
    if (loggingOut) return
    setLoggingOut(true)
    try {
      const res = await fetch('/api/auth/logout', { method: 'POST' })
      if (!res.ok) { toast('Gagal keluar, coba lagi'); return }
      // Navigasi penuh (bukan router.push): koneksi realtime dan data yang tersimpan ikut berakhir bersama sesi.
      redirectToLogin({ keepPath: false })
    } catch {
      toast('Gagal keluar, coba lagi')
    } finally {
      setLoggingOut(false)
    }
  }

  const badges: Partial<Record<ViewKey, number>> = { inbox: counts.inbox, antrean: counts.antrean, agent: counts.agent }

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
                  {!!badges[v] && (
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
                  <input ref={gsRef} placeholder="Cari nama, nomor, atau isi chat" aria-label="Pencarian global" value={q}
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
                    {searching ? <div className="mut" style={{ padding: 12 }}>Mencari…</div> : hits.length ? hits.map((r, i) => (
                      <button key={r.id} type="button" className={i === sel ? 'act' : ''} onClick={() => pick(r)}>
                        <span className="pill info">Chat</span>
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
                    <span className="uav">{initialsOf(me?.name ?? '')}</span><span className="uname">{me?.name ?? '…'}</span>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
                  </button>
                  {udrop && (
                    <div className="udrop" role="menu">
                      <div className="uh"><b>{me?.name ?? '…'}</b><div className="mut sm">{me?.role === 'ADMIN' ? 'Admin' : me?.role === 'AGENT' ? 'Agen' : me?.role ?? ''} · JVTO</div></div>
                      <button role="menuitem" className="out" disabled={loggingOut} onClick={() => { setUdrop(false); void logout() }}>{loggingOut ? 'Keluar…' : 'Keluar'}</button>
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
      </div>
    </StoreCtx.Provider>
  )
}

