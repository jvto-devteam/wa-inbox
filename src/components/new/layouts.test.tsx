import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NewShell } from './Shell'
import { AntreanView } from './views/AntreanView'
import { InboxView } from './views/InboxView'
import { LaporanView } from './views/LaporanView'
import { RingkasanView } from './views/RingkasanView'

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

  it('Laporan: lead dikelompokkan, yang menunggu balasan kita lebih dulu', () => {
    show(<LaporanView />)
    const secs = Array.from(document.querySelectorAll('#l-leads .pg-sec')).map((e) => e.textContent)
    expect(secs[0]).toMatch(/^Menunggu balasan kita/)
    expect(document.querySelectorAll('#l-trend .db-col')).toHaveLength(8)
    const first = document.querySelector('#l-bookings .l-mlist .item')!
    expect(first.textContent).toMatch(/Chat \d+ \w+ → booking \d+ \w+ · (hari sama|\d+ hari)/)
  })
})
