'use client'
import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { AiAgentKey } from '@/lib/ai-office/activity'
import { agentUpdateFromEvent, IDLE_LABEL, MODE_TTL_MS, type AgentLive, type AgentMode, type OfficeEvent } from '@/lib/ai-office/state'
import { conversationHref } from '@/components/daily-summary/conversation-href'
import { fetchJson } from '@/lib/fetch-json'
import { wibDateTimeLabel } from '@/lib/summary-items/status'
import { cn } from '@/lib/utils'
import type { AiOfficeResponse } from '@/app/api/ai-office/route'

/**
 * Kantor AI (owner 2026-10-23): kantor isometrik tempat asisten AI wa-inbox terlihat bekerja. Digerakkan event NYATA
 * dari SSE -- `pipeline.step` (bot balasan) dan `ai.activity` (label topik, aksi booking, ringkasan chat) -- bukan
 * animasi pura-pura. Karakter mengetik saat bekerja, berjalan ke meja admin saat mengantar hasil, lalu kembali.
 * Hanya label pendek yang tampil; isi chat tidak pernah dikirim ke halaman ini.
 */

type AgentConfig = { key: AiAgentKey; name: string; role: string; shirt: string; hair: string; skin: string; desk: [number, number] }

const AGENTS: AgentConfig[] = [
  { key: 'topik', name: 'Tika', role: 'Label topik pesan', shirt: '#7c9cf5', hair: '#2f2118', skin: '#f2c9a5', desk: [1.4, 2.6] },
  { key: 'bot', name: 'Rafi', role: 'CS Bot · balas tamu', shirt: '#45b39a', hair: '#1f1a17', skin: '#d9a77f', desk: [4.4, 2.6] },
  { key: 'booking', name: 'Oka', role: 'Ops Booking · ubah data', shirt: '#f0a24b', hair: '#3a2a1d', skin: '#c98f66', desk: [1.4, 6.0] },
  { key: 'ringkasan', name: 'Sari', role: 'Analis · ringkasan chat', shirt: '#d97ab8', hair: '#5a3420', skin: '#f0c4a0', desk: [4.4, 6.0] },
]

const VIEW_W = 1000
const VIEW_H = 620
const ADMIN_DESK: [number, number] = [7.4, 1.4]
/** Titik berdiri di depan meja admin saat mengantar hasil. */
const ADMIN_SPOT: [number, number] = [8.2, 3.1]

/** Proyeksi isometrik: koordinat lantai (gx, gy) + tinggi h -> titik layar di viewBox. */
function iso(gx: number, gy: number, h = 0): [number, number] {
  return [500 + (gx - gy) * 46, 110 + (gx + gy) * 23 - h]
}
const pts = (list: Array<[number, number]>) => list.map(([x, y]) => `${x},${y}`).join(' ')

function IsoBox({ x, y, w, d, h, top, left, right }: { x: number; y: number; w: number; d: number; h: number; top: string; left: string; right: string }) {
  const t = [iso(x, y, h), iso(x + w, y, h), iso(x + w, y + d, h), iso(x, y + d, h)]
  const rightFace = [iso(x + w, y, h), iso(x + w, y + d, h), iso(x + w, y + d, 0), iso(x + w, y, 0)]
  const leftFace = [iso(x, y + d, h), iso(x + w, y + d, h), iso(x + w, y + d, 0), iso(x, y + d, 0)]
  return (
    <g>
      <polygon points={pts(rightFace)} fill={right} />
      <polygon points={pts(leftFace)} fill={left} />
      <polygon points={pts(t)} fill={top} />
    </g>
  )
}

function Desk({ at, glow }: { at: [number, number]; glow: boolean }) {
  const [x, y] = at
  const m1 = iso(x + 0.55, y + 0.25, 22)
  const m2 = iso(x + 1.45, y + 0.25, 22)
  return (
    <g>
      <IsoBox x={x} y={y} w={2} d={1} h={22} top="#efe3cc" left="#d8c7a6" right="#cbb894" />
      {/* Monitor: menyala saat asistennya bekerja. */}
      <polygon points={pts([m1, m2, [m2[0], m2[1] - 30], [m1[0], m1[1] - 30]])} fill={glow ? '#cfe9ff' : '#2b3440'} stroke="#1c232c" strokeWidth={2} />
      {glow && <polygon className="ai-screen" points={pts([[m1[0] + 6, m1[1] - 22], [m2[0] - 6, m2[1] - 22], [m2[0] - 6, m2[1] - 18], [m1[0] + 6, m1[1] - 18]])} fill="#5aa9e6" />}
      <IsoBox x={x + 0.75} y={y + 1.35} w={0.5} d={0.5} h={14} top="#4a5563" left="#3a434f" right="#323a45" />
    </g>
  )
}

function Person({ cfg, mode, pos }: { cfg: Pick<AgentConfig, 'shirt' | 'hair' | 'skin'>; mode: AgentMode | 'admin'; pos: [number, number] }) {
  const [x, y] = iso(pos[0], pos[1])
  return (
    <g style={{ transform: `translate(${x}px, ${y}px)`, transition: 'transform 1.4s ease-in-out' }}>
      <ellipse cx={0} cy={2} rx={16} ry={6} fill="rgba(0,0,0,0.18)" />
      <g className={mode === 'working' ? 'ai-typing' : mode === 'handoff' ? 'ai-walking' : undefined}>
        <rect x={-11} y={-34} width={22} height={30} rx={9} fill={cfg.shirt} />
        <circle cx={0} cy={-44} r={11} fill={cfg.skin} />
        <path d="M-11,-46 a11,11 0 0 1 22,0 v-3 a11,9 0 0 0 -22,0 z" fill={cfg.hair} />
        {mode === 'handoff' && <rect x={9} y={-24} width={12} height={15} rx={2} fill="#fff" stroke="#9aa5b1" />}
      </g>
    </g>
  )
}

function OfficeScene({ live, atAdmin }: { live: Record<AiAgentKey, AgentLive>; atAdmin: Record<AiAgentKey, boolean> }) {
  const floor = [iso(0, 0), iso(10, 0), iso(10, 10), iso(0, 10)]
  const wallBack = [iso(0, 0), iso(10, 0), iso(10, 0, 120), iso(0, 0, 120)]
  const wallLeft = [iso(0, 0), iso(0, 10), iso(0, 10, 120), iso(0, 0, 120)]
  const glass = [iso(6.6, 0), iso(6.6, 4.4), iso(6.6, 4.4, 95), iso(6.6, 0, 95)]
  const glass2 = [iso(6.6, 4.4), iso(10, 4.4), iso(10, 4.4, 95), iso(6.6, 4.4, 95)]
  return (
    <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} className="h-full w-full" role="img" aria-label="Kantor AI: meja setiap asisten AI dan meja admin">
      <style>{`
        @keyframes ai-type { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-2px) } }
        @keyframes ai-walk { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-4px) } }
        @keyframes ai-blink { 0%,100% { opacity: 1 } 50% { opacity: .35 } }
        .ai-typing { animation: ai-type .45s ease-in-out infinite }
        .ai-walking { animation: ai-walk .35s ease-in-out infinite }
        .ai-screen { animation: ai-blink 1s ease-in-out infinite }
        @media (prefers-reduced-motion: reduce) { .ai-typing, .ai-walking, .ai-screen { animation: none } }
      `}</style>
      <polygon points={pts(wallBack)} fill="#e9e6df" />
      <polygon points={pts(wallLeft)} fill="#dedad2" />
      <polygon points={pts(floor)} fill="#f6f1e7" stroke="#e4dccb" />
      {/* Ruang kaca admin. */}
      <polygon points={pts([iso(6.6, 0), iso(10, 0), iso(10, 4.4), iso(6.6, 4.4)])} fill="#eef3f6" />
      <Desk at={ADMIN_DESK} glow={false} />
      <Person cfg={{ shirt: '#3b5b8c', hair: '#222', skin: '#d6a27a' }} mode="admin" pos={[ADMIN_DESK[0] + 1, ADMIN_DESK[1] + 1.55]} />
      <polygon points={pts(glass)} fill="rgba(170,200,220,0.18)" stroke="#9fb3c2" strokeWidth={2} />
      <polygon points={pts(glass2)} fill="rgba(170,200,220,0.18)" stroke="#9fb3c2" strokeWidth={2} />
      {/* Tanaman. */}
      {([[0.6, 9.2], [9.3, 9.2], [6.2, 8.8]] as Array<[number, number]>).map(([gx, gy]) => {
        const [x, y] = iso(gx, gy)
        return (
          <g key={`${gx}-${gy}`}>
            <rect x={x - 9} y={y - 16} width={18} height={16} rx={3} fill="#c9a77d" />
            <circle cx={x - 6} cy={y - 26} r={10} fill="#5f9e62" />
            <circle cx={x + 6} cy={y - 28} r={11} fill="#4f8f54" />
            <circle cx={x} cy={y - 38} r={10} fill="#6aab6c" />
          </g>
        )
      })}
      {AGENTS.map((a) => (
        <Desk key={a.key} at={a.desk} glow={live[a.key].mode === 'working'} />
      ))}
      {AGENTS.map((a) => (
        <Person key={a.key} cfg={a} mode={live[a.key].mode} pos={atAdmin[a.key] ? ADMIN_SPOT : [a.desk[0] + 1, a.desk[1] + 1.55]} />
      ))}
    </svg>
  )
}

const MODE_TEXT: Record<AgentMode, string> = { idle: 'Siaga', working: 'Bekerja', done: 'Selesai', handoff: 'Mengantar hasil', error: 'Gagal' }
const MODE_DOT: Record<AgentMode, string> = {
  idle: 'bg-ink-subtle',
  working: 'bg-accent animate-pulse',
  done: 'bg-success',
  handoff: 'bg-warning',
  error: 'bg-danger',
}

type LogEntry = { id: number; agent: AiAgentKey; label: string; mode: AgentMode; at: string; conversationId: string | null }

function initialLive(): Record<AiAgentKey, AgentLive> {
  const now = new Date().toISOString()
  return Object.fromEntries(AGENTS.map((a) => [a.key, { mode: 'idle', label: IDLE_LABEL[a.key], conversationId: null, at: now }])) as Record<AiAgentKey, AgentLive>
}

export function AiOffice() {
  const [live, setLive] = useState<Record<AiAgentKey, AgentLive>>(initialLive)
  // Salinan sinkron dari `live`: dipakai memutuskan apakah sebuah event benar-benar mengubah meja (untuk log).
  const liveRef = useRef<Record<AiAgentKey, AgentLive>>(live)
  const [atAdmin, setAtAdmin] = useState<Record<AiAgentKey, boolean>>({ topik: false, bot: false, booking: false, ringkasan: false })
  const [status, setStatus] = useState<AiOfficeResponse | null>(null)
  const [log, setLog] = useState<LogEntry[]>([])
  const timers = useRef<Map<AiAgentKey, ReturnType<typeof setTimeout>[]>>(new Map())
  const logId = useRef(0)

  useEffect(() => {
    fetchJson<AiOfficeResponse>('/api/ai-office').then(setStatus).catch(() => {})
  }, [])

  const apply = useCallback((event: OfficeEvent) => {
    const update = agentUpdateFromEvent(event)
    if (!update) return
    const { agent, live: next } = update
    for (const t of timers.current.get(agent) ?? []) clearTimeout(t)
    const pending: ReturnType<typeof setTimeout>[] = []
    const prev = liveRef.current[agent]
    const changed = prev.mode !== next.mode || prev.label !== next.label
    const setAgent = (value: AgentLive) => {
      liveRef.current = { ...liveRef.current, [agent]: value }
      setLive(liveRef.current)
    }
    setAgent(next)
    setAtAdmin((prev) => ({ ...prev, [agent]: next.mode === 'handoff' }))
    if (next.mode === 'handoff') pending.push(setTimeout(() => setAtAdmin((p) => ({ ...p, [agent]: false })), 2800))
    const ttl = MODE_TTL_MS[next.mode]
    if (ttl > 0) {
      pending.push(setTimeout(() => setAgent({ mode: 'idle', label: IDLE_LABEL[agent], conversationId: null, at: new Date().toISOString() }), ttl))
    }
    timers.current.set(agent, pending)
    if (next.mode === 'done' || next.mode === 'handoff') {
      setStatus((s) =>
        s
          ? {
              agents: s.agents.map((a) =>
                a.agent === agent ? { ...a, lastAt: next.at, lastLabel: next.label, lastConversationId: next.conversationId, todayCount: a.todayCount + 1 } : a
              ),
            }
          : s
      )
    }
    // Log hanya perubahan (bot memancarkan banyak langkah berlabel sama).
    if (changed) {
      const entry: LogEntry = { id: ++logId.current, agent, label: next.label, mode: next.mode, at: next.at, conversationId: next.conversationId }
      setLog((l) => [entry, ...l].slice(0, 40))
    }
  }, [])

  useEffect(() => {
    if (typeof EventSource === 'undefined') return
    const es = new EventSource('/api/sse')
    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data) as { type?: string }
        if (event.type === 'pipeline.step' || event.type === 'ai.activity') apply(event as OfficeEvent)
      } catch {
        // Event rusak diabaikan.
      }
    }
    const allTimers = timers.current
    return () => {
      es.close()
      for (const list of allTimers.values()) for (const t of list) clearTimeout(t)
    }
  }, [apply])

  const byKey = Object.fromEntries(AGENTS.map((a) => [a.key, a])) as Record<AiAgentKey, AgentConfig>

  return (
    <div className="flex flex-col gap-4">
      <div className="relative w-full overflow-hidden rounded-xl border border-line bg-surface" style={{ aspectRatio: `${VIEW_W} / ${VIEW_H}` }}>
        <OfficeScene live={live} atAdmin={atAdmin} />
        {/* Balon status, diposisikan di atas kepala karakter (koordinat viewBox -> persen). */}
        {AGENTS.map((a) => {
          const [x, y] = iso(...(atAdmin[a.key] ? ADMIN_SPOT : ([a.desk[0] + 1, a.desk[1] + 1.55] as [number, number])))
          const l = live[a.key]
          return (
            <div
              key={a.key}
              className={cn(
                'pointer-events-none absolute max-w-[42%] -translate-x-1/2 -translate-y-full rounded-lg border bg-surface/95 px-2 py-1 text-[10px] leading-tight shadow-sm sm:text-xs',
                l.mode === 'error' ? 'border-danger/50' : l.mode === 'working' ? 'border-accent/40' : 'border-line'
              )}
              style={{ left: `${(x / VIEW_W) * 100}%`, top: `${((y - 62) / VIEW_H) * 100}%`, transition: 'left 1.4s ease-in-out, top 1.4s ease-in-out' }}
            >
              <p className="flex items-center gap-1 font-semibold text-ink">
                <span className={cn('inline-block size-1.5 rounded-full', MODE_DOT[l.mode])} aria-hidden />
                {a.name}
              </p>
              <p className="truncate text-ink-muted">{l.label}</p>
            </div>
          )
        })}
        <div
          className="pointer-events-none absolute -translate-x-1/2 rounded-md bg-navy px-2 py-0.5 text-[10px] font-medium text-white sm:text-xs"
          style={{ left: `${(iso(ADMIN_DESK[0] + 1, ADMIN_DESK[1])[0] / VIEW_W) * 100}%`, top: `${((iso(ADMIN_DESK[0] + 1, ADMIN_DESK[1])[1] - 70) / VIEW_H) * 100}%` }}
        >
          Meja Admin
        </div>
      </div>

      <ul aria-label="Asisten AI" className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {AGENTS.map((a) => {
          const s = status?.agents.find((x) => x.agent === a.key)
          const l = live[a.key]
          return (
            <li key={a.key} className="rounded-lg border border-line bg-surface p-3">
              <div className="flex items-center gap-2">
                <span className="grid size-8 place-items-center rounded-full text-xs font-semibold text-white" style={{ background: a.shirt }} aria-hidden>
                  {a.name.slice(0, 2).toUpperCase()}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink">{a.name}</p>
                  <p className="truncate text-xs text-ink-muted">{a.role}</p>
                </div>
              </div>
              <p className="mt-2 flex items-center gap-1.5 text-xs text-ink">
                <span className={cn('inline-block size-2 rounded-full', MODE_DOT[l.mode])} aria-hidden />
                {MODE_TEXT[l.mode]} · <span className="truncate text-ink-muted">{l.label}</span>
              </p>
              <p className="mt-1 text-xs text-ink-subtle">
                Terakhir: {s?.lastLabel ?? '—'}
                {s?.lastAt ? ` · ${wibDateTimeLabel(s.lastAt, { compact: true })}` : ''}
              </p>
              <p className="text-xs text-ink-subtle">Hari ini: {s ? s.todayCount : '…'} pekerjaan</p>
            </li>
          )
        })}
      </ul>

      <section aria-label="Kegiatan terbaru" className="rounded-lg border border-line bg-surface p-3">
        <h2 className="mb-2 text-sm font-semibold text-ink">Kegiatan terbaru (live)</h2>
        {log.length === 0 ? (
          <p className="text-sm text-ink-muted">Belum ada kegiatan sejak halaman dibuka. Kegiatan muncul begitu ada pesan masuk.</p>
        ) : (
          <ul className="divide-y divide-line">
            {log.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 py-1.5 text-sm">
                <span className="text-xs tabular-nums text-ink-subtle">{wibDateTimeLabel(e.at, { compact: true })}</span>
                <span className={cn('inline-block size-1.5 rounded-full', MODE_DOT[e.mode])} aria-hidden />
                <span className="font-medium text-ink">{byKey[e.agent].name}</span>
                <span className="text-ink-muted">{e.label}</span>
                {e.conversationId && (
                  <Link href={conversationHref(e.conversationId, null)} className="focus-ring ml-auto rounded-sm text-xs text-accent underline-offset-2 hover:underline">
                    Lihat chat
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
