import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NewShell } from './Shell'
import { AgentView } from './views/AgentView'
import { AntreanView } from './views/AntreanView'
import { BotView } from './views/BotView'
import { InboxView } from './views/InboxView'
import { KontakView } from './views/KontakView'
import { LaporanView } from './views/LaporanView'
import { RingkasanView } from './views/RingkasanView'
import { TemplateView } from './views/TemplateView'

vi.mock('next/navigation', () => ({ usePathname: () => '/new/antrean', useRouter: () => ({ push: vi.fn() }) }))

beforeEach(() => {
  window.matchMedia = ((q: string) => ({
    matches: false, media: q, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
})

const kpis = () => document.querySelector('.db-kpi') as HTMLElement

describe('hero + KPI di halaman /new', () => {
  it.each([
    ['Antrean', <AntreanView key="a" />],
    ['Ringkasan', <RingkasanView key="r" />],
    ['Laporan', <LaporanView key="l" />],
    ['Riwayat Agent', <AgentView key="g" />],
    ['Kontak', <KontakView key="k" />],
    ['Template', <TemplateView key="t" />],
    ['Bot', <BotView key="b" />],
  ])('%s punya jumbotron dan baris KPI', (_n, el) => {
    render(<NewShell>{el}</NewShell>)
    expect(document.querySelector('.db-hero h2')?.textContent).toBeTruthy()
    expect(kpis().querySelectorAll('.db-k').length).toBeGreaterThanOrEqual(4)
  })

  it('Inbox tetap tanpa jumbotron', () => {
    render(<NewShell><InboxView /></NewShell>)
    expect(document.querySelector('.db-hero')).toBeNull()
  })

  it('Antrean: KPI berfungsi sebagai tab', () => {
    render(<NewShell><AntreanView /></NewShell>)
    fireEvent.click(within(kpis()).getByText('Reminder').closest('button')!)
    expect(within(kpis()).getByText('Reminder').closest('button')!.getAttribute('aria-pressed')).toBe('true')
    expect(document.getElementById('a-list')?.textContent).toContain('Cek mutasi pembayaran')
  })

  it('Kontak: KPI Mitra menyaring tabel', () => {
    render(<NewShell><KontakView /></NewShell>)
    fireEvent.click(within(kpis()).getByText('Mitra').closest('button')!)
    const rows = document.querySelectorAll('#k-t tr[data-k]')
    expect(rows).toHaveLength(1)
    expect(rows[0].textContent).toContain('Vendor Transport Bali')
  })

  it('Riwayat Agent: KPI Gagal menyaring status', () => {
    render(<NewShell><AgentView /></NewShell>)
    fireEvent.click(within(kpis()).getByText('Gagal').closest('button')!)
    expect((screen.getByLabelText('Saring status') as HTMLSelectElement).value).toBe('gagal')
    expect(Array.from(document.querySelectorAll('#g-t tr[data-i]')).every((tr) => tr.textContent?.includes('Gagal'))).toBe(true)
  })

  it('Laporan: daftar booking versi ponsel berlabel (chat → booking, kode, paket)', () => {
    render(<NewShell><LaporanView /></NewShell>)
    const first = document.querySelector('#l-bookings .l-mlist .item')!
    expect(first.textContent).toMatch(/Chat \d+ \w+ → booking \d+ \w+ · (hari sama|\d+ hari)/)
    expect(first.textContent).toMatch(/-xxxx · /)
  })

  it('Bot: KPI Knowledge membuka tab Knowledge', () => {
    render(<NewShell><BotView /></NewShell>)
    fireEvent.click(within(kpis()).getByText('Knowledge').closest('button')!)
    expect(document.querySelector('#b-tabs button.on')?.textContent).toBe('Knowledge')
  })
})
