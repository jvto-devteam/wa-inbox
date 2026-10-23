'use client'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { AiAgentKey } from '@/lib/ai-office/activity'
import { agentUpdateFromEvent, IDLE_LABEL, MODE_TTL_MS, type AgentLive, type AgentMode, type OfficeEvent } from '@/lib/ai-office/state'
import { conversationHref } from '@/components/daily-summary/conversation-href'
import { fetchJson } from '@/lib/fetch-json'
import { wibDateTimeLabel } from '@/lib/summary-items/status'
import { cn } from '@/lib/utils'
import type { AiOfficeResponse } from '@/app/api/ai-office/route'

/** Adegan WebGL hanya di browser: three.js tidak bisa dirender di server, dan bundelnya tidak ikut halaman lain. */
const Office3D = dynamic(() => import('./Office3D'), {
  ssr: false,
  loading: () => <div className="grid h-full place-items-center text-sm text-ink-muted">Menyiapkan kantor 3D…</div>,
})

/**
 * Kantor AI (owner 2026-10-23): kantor 3D tempat asisten AI wa-inbox terlihat bekerja (adegan di `Office3D.tsx`).
 * Status meja digerakkan event NYATA dari SSE -- `pipeline.step` (bot balasan) dan `ai.activity` (label topik, aksi
 * booking, ringkasan chat). Saat siaga karakter tetap hidup (mengetik santai, minum kopi, meregangkan badan); saat event
 * datang ia bekerja sungguhan dengan indikatornya, lalu berjalan ke meja admin saat mengantar hasil.
 * Hanya label pendek yang tampil; isi chat tidak pernah dikirim ke halaman ini.
 */

type AgentConfig = { key: AiAgentKey; name: string; role: string; shirt: string; hair: string; skin: string }

const AGENTS: AgentConfig[] = [
  { key: 'topik', name: 'Tika', role: 'Label topik pesan', shirt: '#7c9cf5', hair: '#2f2118', skin: '#f2c9a5' },
  { key: 'bot', name: 'Rafi', role: 'CS Bot · balas tamu', shirt: '#45b39a', hair: '#1f1a17', skin: '#d9a77f' },
  { key: 'booking', name: 'Oka', role: 'Ops Booking · ubah data', shirt: '#f0a24b', hair: '#3a2a1d', skin: '#c98f66' },
  { key: 'ringkasan', name: 'Sari', role: 'Analis · ringkasan chat', shirt: '#d97ab8', hair: '#5a3420', skin: '#f0c4a0' },
]

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
      <div
        role="img"
        aria-label="Kantor AI: meja setiap asisten AI dan ruang admin"
        className="relative aspect-[4/3] w-full overflow-hidden rounded-xl border border-line bg-[#f3efe8] sm:aspect-[16/9]"
      >
        <Office3D agents={AGENTS.map((a) => ({ key: a.key, name: a.name, shirt: a.shirt, hair: a.hair, skin: a.skin, mode: live[a.key].mode, label: live[a.key].label }))} />
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
