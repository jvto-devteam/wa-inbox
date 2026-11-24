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

const show = (el: React.ReactNode) => render(<NewShell>{el}</NewShell>)

describe('tata letak berbeda per halaman /new', () => {
  // Jumbotron biru hanya untuk halaman ringkasan (Dashboard, Laporan); lainnya punya bentuk sendiri.
  it.each([
    ['Antrean', <AntreanView key="a" />, '.pg-urgent', false],
    ['Ringkasan', <RingkasanView key="r" />, '#v-ringkasan .pg-urgent', false],
    ['Laporan', <LaporanView key="l" />, '.db-hero', true],
    ['Riwayat Agent', <AgentView key="g" />, '#v-agent .bt-ban', false],
    ['Kontak', <KontakView key="k" />, '.kt-c', false],
    ['Template', <TemplateView key="t" />, '#v-template .bt-ban', false],
    ['Bot', <BotView key="b" />, '.bt-ban', false],
    ['Inbox', <InboxView key="i" />, '.inbox', false],
  ])('%s', (_n, el, signature, hero) => {
    show(el)
    expect(document.querySelector(signature as string)).not.toBeNull()
    expect(!!document.querySelector('.db-hero')).toBe(hero)
  })

  it('Antrean: kartu paling mendesak + batang komposisi berfungsi sebagai tab', () => {
    show(<AntreanView />)
    expect(document.querySelector('.pg-urgent')?.textContent).toContain('Sarah M.')
    fireEvent.click(within(document.getElementById('a-tabs')!).getByText('Reminder').closest('button')!)
    expect(document.querySelector('#a-tabs button.on')?.textContent).toMatch(/^Reminder 2/)
    expect(document.getElementById('a-list')?.textContent).toContain('Cek mutasi pembayaran')
  })

  it('Ringkasan: sorotan komplain di atas, sebaran jenis menyaring poin, tombol Per percakapan', () => {
    show(<RingkasanView />)
    expect(document.querySelector('.pg-urgent')?.textContent).toMatch(/komplain.*Lukas B\./)
    fireEvent.click(within(document.getElementById('r-chips')!).getByText('komplain').closest('button')!)
    const pts = document.querySelectorAll('#r-pts .item')
    expect(pts).toHaveLength(1)
    expect(pts[0].textContent).toContain('Lukas B.')
    fireEvent.click(screen.getByText(/^Per percakapan/))
    expect(document.querySelectorAll('#r-chats details').length).toBeGreaterThan(5)
    expect(document.getElementById('r-pts')).toBeNull()
  })

  it('Riwayat Agent: banner peringatan bila ada yang gagal, linimasa per jam, strip Gagal menyaring', () => {
    show(<AgentView />)
    expect(document.querySelector('#v-agent .bt-ban')?.className).toContain('warn')
    expect(document.querySelector('#v-agent .bt-ban .tx span')?.textContent).toMatch(/^2 gagal perlu dicek/)
    expect(document.querySelector('.ag-h')?.textContent).toMatch(/^\d\d\.00$/)
    fireEvent.click(within(document.getElementById('g-hk')!).getByText('Gagal').closest('button')!)
    expect((screen.getByLabelText('Saring status') as HTMLSelectElement).value).toBe('gagal')
    const evs = document.querySelectorAll('#g-t .ag-ev')
    expect(evs.length).toBeGreaterThan(0)
    expect(Array.from(evs).map((e) => e.querySelector('.pill')?.textContent)).toEqual(Array(evs.length).fill('Gagal'))
  })

  it('Kontak: komposisi Mitra menyaring kartu', () => {
    show(<KontakView />)
    fireEvent.click(within(document.getElementById('k-hk')!).getByText('Mitra').closest('button')!)
    const cards = document.querySelectorAll('#k-t .kt-c')
    expect(cards).toHaveLength(1)
    expect(cards[0].textContent).toContain('Vendor Transport Bali')
  })

  it('Template: pola Bot (banner, strip, tab kategori) dan tab menyaring daftar', () => {
    show(<TemplateView />)
    expect(document.querySelector('.bt-ban b')?.textContent).toBe('33 template pesan sistem')
    fireEvent.click(within(document.getElementById('t-hk')!).getByText('Reminder').closest('button')!)
    expect(document.querySelectorAll('#t-list .item')).toHaveLength(11)
    fireEvent.click(within(document.getElementById('t-chips')!).getByText('Trip').closest('button')!)
    expect(document.querySelectorAll('#t-list .item')).toHaveLength(2)
  })

  it('Bot: sakelar banner langsung berlaku, strip membuka tab', () => {
    show(<BotView />)
    fireEvent.click(screen.getByLabelText('Bot menjawab semua chat', { selector: '.bt-ban input' }))
    expect(document.querySelector('.bt-ban b')?.textContent).toBe('Bot dimatikan, tim membalas manual')
    fireEvent.click(within(document.getElementById('b-hk')!).getByText('Knowledge terbit').closest('button')!)
    expect(document.querySelector('#b-tabs button.on')?.textContent).toBe('Knowledge')
  })

  it('Laporan: lead dikelompokkan, yang menunggu balasan kita lebih dulu', () => {
    show(<LaporanView />)
    const secs = Array.from(document.querySelectorAll('#l-leads .pg-sec')).map((e) => e.textContent)
    expect(secs[0]).toMatch(/^Menunggu balasan kita/)
    expect(document.querySelectorAll('#l-trend .db-col')).toHaveLength(8)
    const first = document.querySelector('#l-bookings .l-mlist .item')!
    expect(first.textContent).toMatch(/Chat \d+ \w+ → booking \d+ \w+ · (hari sama|\d+ hari)/)
  })
})
