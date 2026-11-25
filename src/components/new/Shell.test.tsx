import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { stubReportFetch } from './__fixtures__/report'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NewShell } from './Shell'
import { viewFromPath } from './store'
import { AgentView } from './views/AgentView'
import { AntreanView } from './views/AntreanView'
import { BotView } from './views/BotView'
import { HubView } from './views/HubView'
import { LaporanView } from './views/LaporanView'
import { RingkasanView } from './views/RingkasanView'

let path = '/new/dashboard'
const push = vi.fn()
vi.mock('next/navigation', () => ({ usePathname: () => path, useRouter: () => ({ push }) }))

beforeEach(() => {
  push.mockClear()
  window.matchMedia = ((q: string) => ({
    matches: false, media: q, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
})

function at(p: string, el: React.ReactNode) {
  path = p
  return render(<NewShell>{el}</NewShell>)
}

describe('/new', () => {
  it('memetakan URL ke tampilan', () => {
    expect(viewFromPath('/new/dashboard')).toBe('hub')
    expect(viewFromPath('/new/agent')).toBe('agent')
    expect(viewFromPath('/new')).toBe('hub')
  })

  it.each([
    ['/new/dashboard', <HubView key="h" />, 'Perlu perhatian'],
    ['/new/antrean', <AntreanView key="a" />, 'Janji Admin'],
    ['/new/ringkasan', <RingkasanView key="r" />, 'Per percakapan'],
    ['/new/agent', <AgentView key="g" />, 'Semua status'],
    ['/new/laporan', <LaporanView key="l" />, 'Belum booking: alasan & follow-up'],
  ])('%s tergambar dengan data contoh', (p, el, text) => {
    at(p, el)
    expect(document.body.textContent + Array.from(document.querySelectorAll('textarea')).map((t) => t.placeholder).join(' ')).toContain(text)
    expect(screen.queryByText('Data contoh')).toBeNull()
  })

  it('menu sidebar berpindah lewat router, bukan hash', () => {
    at('/new/dashboard', <HubView />)
    fireEvent.click(screen.getByTitle('Kontak'))
    expect(push).toHaveBeenCalledWith('/new/kontak')
  })

  it('tab Bot → Agent menampilkan tugas reminder tamu, crew, vendor', () => {
    at('/new/bot', <BotView />)
    fireEvent.click(screen.getByText('Agent', { selector: '#b-tabs button' }))
    for (const t of ['Pelunasan · H-7 · 15:00', 'Info trip · H-2 · 20:00', 'Trip selesai · Hari terakhir · 15:00', 'Reminder crew · H-1 · 10:00', 'Vendor transport Bali · H-1 · 15:15']) {
      expect(screen.getByText(t)).toBeInTheDocument()
    }
  })

  it('Dashboard: KPI, tren, alasan belum booking dari API laporan asli', async () => {
    const fetchMock = stubReportFetch()
    at('/new/dashboard', <HubView />)
    await waitFor(() => expect(screen.getByText(/lead menunggu balasan kita/)).toBeInTheDocument())
    expect(fetchMock.mock.calls.some((c) => String(c[0]).startsWith('/api/new/report?from='))).toBe(true)
    expect(screen.getByText('Inquiry vs booking · 8 minggu')).toBeInTheDocument()
    expect(screen.getByText('Kenapa belum booking')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /^Inquiry dan booking 8 minggu/ })).toBeInTheDocument()
    vi.unstubAllGlobals()
  })
  it('Dashboard: hover kolom tren menampilkan tooltip angka minggu itu', async () => {
    stubReportFetch()
    at('/new/dashboard', <HubView />)
    await waitFor(() => expect(document.querySelectorAll('.db-col')).toHaveLength(8))
    const cols = document.querySelectorAll('.db-col')
    expect(cols).toHaveLength(8)
    fireEvent.mouseEnter(cols[0])
    expect(document.querySelector('.db-tip')?.textContent).toMatch(/inquiry · \d+ booking \(\d+%\)/)
    fireEvent.mouseLeave(cols[0])
    expect(document.querySelector('.db-tip')).toBeNull()
  })

})
