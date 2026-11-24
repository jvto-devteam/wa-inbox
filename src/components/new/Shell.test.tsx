import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NewShell } from './Shell'
import { viewFromPath } from './store'
import { AgentView } from './views/AgentView'
import { AntreanView } from './views/AntreanView'
import { BotView } from './views/BotView'
import { HubView } from './views/HubView'
import { InboxView } from './views/InboxView'
import { KontakView } from './views/KontakView'
import { LaporanView } from './views/LaporanView'
import { RingkasanView } from './views/RingkasanView'
import { TemplateView } from './views/TemplateView'

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
    ['/new/inbox', <InboxView key="i" />, 'Tulis balasan…'],
    ['/new/antrean', <AntreanView key="a" />, 'Janji Admin'],
    ['/new/ringkasan', <RingkasanView key="r" />, 'Per percakapan'],
    ['/new/agent', <AgentView key="g" />, 'Semua status'],
    ['/new/kontak', <KontakView key="k" />, 'Vendor Transport Bali'],
    ['/new/bot', <BotView key="b" />, 'Mode bot'],
    ['/new/template', <TemplateView key="t" />, 'payment_reminder_balance'],
    ['/new/laporan', <LaporanView key="l" />, 'Belum booking: alasan & follow-up'],
  ])('%s tergambar dengan data contoh', (p, el, text) => {
    at(p, el)
    expect(document.body.textContent + Array.from(document.querySelectorAll('textarea')).map((t) => t.placeholder).join(' ')).toContain(text)
    expect(screen.getByText('Data contoh')).toBeInTheDocument()
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

  it('Kirim sekarang untuk reminder crew mengeluarkannya dari jadwal', () => {
    at('/new/antrean', <AntreanView />)
    fireEvent.click(screen.getByText(/^Follow-up agent/))
    const row = screen.getByText(/Reminder crew \(H-1\)/).closest('.item') as HTMLElement
    fireEvent.click(Array.from(row.querySelectorAll('button')).find((b) => b.textContent === 'Kirim sekarang')!)
    expect(screen.queryByText(/Reminder crew \(H-1\)/)).toBeNull()
  })

  it('Template pesan: buka, ubah, simpan', () => {
    at('/new/template', <TemplateView />)
    fireEvent.click(within(document.getElementById('t-chips')!).getByText('Reminder').closest('button')!)
    const row = screen.getByText('payment_reminder_balance').closest('.item') as HTMLElement
    fireEvent.click(row)
    const ta = screen.getByLabelText('Isi pesan') as HTMLTextAreaElement
    fireEvent.change(ta, { target: { value: ta.value + '\n{tidak_ada}' } })
    expect(screen.getByText(/tidak dideklarasikan/)).toBeInTheDocument()
    expect((screen.getByText('Simpan') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(ta, { target: { value: 'Halo {customer_name}' } })
    fireEvent.click(screen.getByText('Simpan'))
    expect(screen.getByText('Tersimpan (pratinjau, belum ke server)')).toBeInTheDocument()
  })

  it('Dashboard: KPI, tren, alasan belum booking, strip agent dari data contoh, tanpa fetch', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    at('/new/dashboard', <HubView />)
    expect(screen.getByText('Inquiry vs booking · 8 minggu')).toBeInTheDocument()
    expect(screen.getByText('Kenapa belum booking')).toBeInTheDocument()
    expect(screen.getByText(/lead menunggu balasan kita/)).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /^Inquiry dan booking 8 minggu/ })).toBeInTheDocument()
    const tiles = document.querySelectorAll('.db-ag')
    expect(tiles).toHaveLength(8)
    const balas = Array.from(tiles).find((t) => t.textContent?.includes('Balas pesan'))!
    expect(balas.textContent).toMatch(/Terakhir \d\d:\d\d/)
    const lead = Array.from(tiles).find((t) => t.textContent?.includes('Follow-up lead'))!
    expect(lead.textContent).toMatch(/Draf saja/)
    const vendor = Array.from(tiles).find((t) => t.textContent?.includes('Reminder ke vendor'))!
    expect(vendor.textContent).toMatch(/1 gagal/)
    expect(fetchMock).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('Dashboard: hover kolom tren menampilkan tooltip angka minggu itu', () => {
    at('/new/dashboard', <HubView />)
    const cols = document.querySelectorAll('.db-col')
    expect(cols).toHaveLength(8)
    fireEvent.mouseEnter(cols[0])
    expect(document.querySelector('.db-tip')?.textContent).toMatch(/inquiry · \d+ booking \(\d+%\)/)
    fireEvent.mouseLeave(cols[0])
    expect(document.querySelector('.db-tip')).toBeNull()
  })

  it('Kirim di Inbox menambah pesan admin dan membuang draf', () => {
    at('/new/inbox', <InboxView />)
    fireEvent.click(screen.getByText('Lukas B.', { selector: '.row b *, .row b' }).closest('button')!)
    const ta = screen.getByLabelText('Tulis balasan') as HTMLTextAreaElement
    expect(ta.value).toContain('Hello Lukas')
    fireEvent.click(screen.getByText('Kirim'))
    expect(document.querySelectorAll('#i-chat .m.a')).toHaveLength(1)
    expect(screen.queryByText(/Draf dari/)).toBeNull()
  })
})
