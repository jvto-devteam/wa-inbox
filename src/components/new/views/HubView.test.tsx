import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NewShell } from '../Shell'
import { AgentView } from './AgentView'
import { AntreanView } from './AntreanView'
import { BotView } from './BotView'
import { HubView } from './HubView'
import { RingkasanView } from './RingkasanView'

const push = vi.fn()
vi.mock('next/navigation', () => ({ usePathname: () => '/new/dashboard', useRouter: () => ({ push }) }))

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
function renderWith(target?: React.ReactNode) {
  render(<NewShell><HubView />{target}</NewShell>)
  return document.getElementById('v-hub')!
}

describe('Dashboard: setiap item punya rujukan', () => {
  it('tidak ada tombol mati: semua tombol Dashboard (selain chip saringan) membuka halaman', () => {
    const hub = renderWith()
    const buttons = Array.from(hub.querySelectorAll('button')).filter((b) => !b.closest('.db-chips'))
    expect(buttons.length).toBeGreaterThan(30)
    for (const b of buttons) {
      push.mockClear()
      fireEvent.click(b)
      expect(push, b.textContent || b.className).toHaveBeenCalled()
    }
  })

  it('Agent gagal → Riwayat Agent hari ini, status Gagal', () => {
    const hub = renderWith(<AgentView />)
    fireEvent.change(screen.getByLabelText('Saring status'), { target: { value: 'ok' } })
    fireEvent.click(within(hub).getByText('Agent gagal').closest('button')!)
    expect(push).toHaveBeenLastCalledWith('/new/agent')
    expect((screen.getByLabelText('Saring status') as HTMLSelectElement).value).toBe('gagal')
    expect((document.getElementById('g-day') as HTMLSelectElement).value).toBe('Hari ini')
  })

  it('kartu agent → Riwayat Agent tersaring agent itu, saringan status di-reset', () => {
    const hub = renderWith(<AgentView />)
    fireEvent.change(screen.getByLabelText('Saring status'), { target: { value: 'gagal' } })
    fireEvent.click(within(hub).getByText('Reminder ke crew').closest('button')!)
    expect((screen.getByLabelText('Saring status') as HTMLSelectElement).value).toBe('Semua')
    expect(document.querySelector('#g-chips button.on')?.textContent).toMatch(/^Reminder ke crew/)
  })

  it('Komplain → Ringkasan hari ini, jenis komplain', () => {
    const hub = renderWith(<RingkasanView />)
    fireEvent.click(within(hub).getByText('Komplain').closest('button')!)
    expect(push).toHaveBeenLastCalledWith('/new/ringkasan')
    expect(document.querySelector('#r-chips button.on')?.textContent).toBe('komplain')
  })

  it('item jadwal → Antrean tab Follow-up agent', () => {
    const hub = renderWith(<AntreanView />)
    fireEvent.click(hub.querySelector('.db-ev')!)
    expect(push).toHaveBeenLastCalledWith('/new/antrean')
    expect(document.querySelector('#a-tabs button.on')?.textContent).toMatch(/^Follow-up agent/)
  })

  it('status agent di hero → Bot tab Agent', () => {
    const hub = renderWith(<BotView />)
    fireEvent.click(within(hub).getByText(/agent berjalan/))
    expect(push).toHaveBeenLastCalledWith('/new/bot')
    expect(document.querySelector('#b-tabs button.on')?.textContent).toBe('Agent')
  })

  it('alasan belum booking dan KPI inquiry → Laporan', () => {
    const hub = renderWith()
    fireEvent.click(hub.querySelector('.db-hb')!)
    expect(push).toHaveBeenLastCalledWith('/new/laporan')
    fireEvent.click(within(hub).getByText('Inquiry minggu ini').closest('button')!)
    expect(push).toHaveBeenLastCalledWith('/new/laporan')
  })
})
