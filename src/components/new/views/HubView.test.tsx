import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { sampleQueue } from '../__fixtures__/antrean'
import { sampleReport } from '../__fixtures__/report'
import { sampleSummary } from '../__fixtures__/summary'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildQueue } from '@/lib/new/antrean'
import type { Activity } from '@/lib/new/agent-activity'
import { AT_KEYS } from '@/lib/new/mock-data'
import { NewShell } from '../Shell'
import { AgentView } from './AgentView'
import { AntreanView } from './AntreanView'
import { HubView } from './HubView'
import { RingkasanView } from './RingkasanView'

const push = vi.fn()
vi.mock('next/navigation', () => ({ usePathname: () => '/dashboard', useRouter: () => ({ push }) }))

const act = (id: string, agent: Activity['agent'], status: Activity['status']): Activity => ({
  id, at: new Date().toISOString(), agent, status, title: 'Tugas ' + id, input: '', output: '', conversationId: null, contact: null,
})

/** Semua route yang dibaca Dashboard (dan halaman tujuannya), dengan data tiruan yang sama dengan test halaman itu. */
function stubAll() {
  const q = sampleQueue()
  const fn = vi.fn(async (input: string, init?: RequestInit) => {
    const path = new URL(input, 'http://x').pathname
    const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response
    if (init?.method && init.method !== 'GET') return ok({ ok: true })
    if (path === '/api/summary-items') return ok(q.items)
    if (path === '/api/new/reminders') return ok({ reminders: q.reminders })
    if (path === '/api/new/agent-schedule') return ok(q.schedule)
    if (path === '/api/daily-summary') return ok(sampleSummary())
    if (path === '/api/new/report') return ok(sampleReport())
    if (path === '/api/new/agent-activity') return ok({ items: [act('a1', 'crew', 'gagal'), act('a2', 'balas', 'ok'), act('a3', 'balas', 'ok')] })
    return { ok: false, status: 404, json: async () => ({ error: 'tidak ada' }) } as Response
  })
  vi.stubGlobal('fetch', fn)
  return { fn, q }
}

afterEach(() => vi.unstubAllGlobals())

beforeEach(() => {
  push.mockClear()
  window.matchMedia = ((q: string) => ({
    matches: false, media: q, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
})

// Dashboard dirender bersama halaman tujuan di Shell yang sama, supaya status yang dibawa
// klik (tab, saringan) bisa diperiksa di halaman tujuannya.
async function renderWith(target?: React.ReactNode) {
  const st = stubAll()
  render(<NewShell><HubView />{target}</NewShell>)
  const hub = document.getElementById('v-hub')!
  await waitFor(() => expect(hub.querySelector('.db-hero p')?.textContent).toContain('hal menunggu tim'))
  await waitFor(() => expect(hub.querySelector('.db-li')).not.toBeNull())
  await waitFor(() => expect(hub.querySelector('.db-ev')).not.toBeNull())
  return { hub, ...st }
}

describe('Dashboard: data asli', () => {
  it('angka antrean = olahan halaman Antrean; agent hari ini dari Riwayat Agent; jadwal hanya yang akan datang', async () => {
    const { hub, q } = await renderWith()
    const Q = buildQueue(q.items, q.reminders, new Date())
    const tot = AT_KEYS.reduce((n, k) => n + Q[k].length, 0)
    expect(tot).toBeGreaterThan(0)
    expect(within(hub).getByText('Isi Antrean').closest('button')!.querySelector('.v')?.textContent).toBe(String(tot))
    expect(hub.querySelector('.db-hero p')?.textContent).toBe('Agent mengerjakan 3 tugas hari ini (2 berhasil), 1 gagal. ' + tot + ' hal menunggu tim.')
    expect(within(hub).getByText('2 agent bekerja hari ini')).toBeTruthy()
    expect(within(hub).getByText('Reminder ke crew').closest('button')!.textContent).toContain('1 gagal')
    // jadwal: yang gagal/lewat tidak tampil; dua yang akan datang tampil
    expect(hub.querySelectorAll('.db-ev')).toHaveLength(2)
    expect(hub.querySelector('.db-tl')?.textContent).toContain('Info trip')
    // poin WhatsApp terbaru membuka chat di /new/inbox, menyorot pesannya
    const lukas = within(hub).getByText('Sopir telat 1 jam di hotel').closest('a')!
    expect(lukas.getAttribute('href')).toBe('/inbox?conversation=c2&message=m7')
    expect(hub.textContent).toContain('Yang terjadi di WhatsApp · 24 Nov')
  })
})

describe('Dashboard: setiap item punya rujukan', () => {
  it('tidak ada tombol mati: semua tombol Dashboard (selain chip saringan) membuka halaman', async () => {
    const { hub } = await renderWith()
    const buttons = Array.from(hub.querySelectorAll('button')).filter((b) => !b.closest('.db-chips'))
    expect(buttons.length).toBeGreaterThan(20)
    // poin WhatsApp kini tautan ke /new/inbox (bukan tombol)
    for (const a of Array.from(hub.querySelectorAll(".db-li"))) expect(a.getAttribute("href")).toMatch(/^\/inbox\?conversation=/)
    for (const b of buttons) {
      push.mockClear()
      fireEvent.click(b)
      expect(push, b.textContent || b.className).toHaveBeenCalled()
    }
  })

  it('Agent gagal → Riwayat Agent hari ini, status Gagal', async () => {
    const { hub } = await renderWith(<AgentView />)
    fireEvent.change(screen.getByLabelText('Saring status'), { target: { value: 'ok' } })
    fireEvent.click(within(hub).getByText('Agent gagal').closest('button')!)
    expect(push).toHaveBeenLastCalledWith('/agent')
    expect((screen.getByLabelText('Saring status') as HTMLSelectElement).value).toBe('gagal')
    expect((document.getElementById('g-day') as HTMLSelectElement).value).toBe('Hari ini')
  })

  it('kartu agent → Riwayat Agent tersaring agent itu, saringan status di-reset', async () => {
    const { hub } = await renderWith(<AgentView />)
    fireEvent.change(screen.getByLabelText('Saring status'), { target: { value: 'gagal' } })
    fireEvent.click(within(hub).getByText('Reminder ke crew').closest('button')!)
    expect((screen.getByLabelText('Saring status') as HTMLSelectElement).value).toBe('Semua')
    expect(document.querySelector('#g-chips button.on')?.textContent).toMatch(/^Reminder ke crew/)
  })

  it('Komplain → Ringkasan terbaru, jenis komplain', async () => {
    const { hub } = await renderWith(<RingkasanView />)
    fireEvent.click(within(hub).getByText('Komplain').closest('button')!)
    expect(push).toHaveBeenLastCalledWith('/ringkasan')
    await waitFor(() => expect(document.querySelector('#r-chips button.on')?.textContent).toMatch(/^komplain \d/))
  })

  it('item jadwal → Antrean tab Jadwal agent', async () => {
    const { hub } = await renderWith(<AntreanView />)
    fireEvent.click(hub.querySelector('.db-ev')!)
    expect(push).toHaveBeenLastCalledWith('/antrean')
    expect(document.querySelector('#a-tabs button.on')?.textContent).toMatch(/^Jadwal agent/)
  })

  it('status agent di hero → Riwayat Agent hari ini', async () => {
    const { hub } = await renderWith(<AgentView />)
    fireEvent.click(within(hub).getByText(/agent bekerja hari ini/))
    expect(push).toHaveBeenLastCalledWith('/agent')
    expect((document.getElementById('g-day') as HTMLSelectElement).value).toBe('Hari ini')
  })

  it('alasan belum booking dan KPI inquiry → Laporan', async () => {
    const { hub } = await renderWith()
    await waitFor(() => expect(hub.querySelector('.db-hb')).not.toBeNull())
    fireEvent.click(hub.querySelector('.db-hb')!)
    expect(push).toHaveBeenLastCalledWith('/laporan')
    fireEvent.click(within(hub).getByText('Inquiry minggu ini').closest('button')!)
    expect(push).toHaveBeenLastCalledWith('/laporan')
  })
})
