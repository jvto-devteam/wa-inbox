import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { sampleReport, stubReportFetch } from './__fixtures__/report'
import { stubSummaryFetch } from './__fixtures__/summary'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NewShell } from './Shell'
import { AntreanView } from './views/AntreanView'
import { InboxView } from './views/InboxView'
import { LaporanView } from './views/LaporanView'
import { RingkasanView } from './views/RingkasanView'

vi.mock('next/navigation', () => ({ usePathname: () => '/new/antrean', useRouter: () => ({ push: vi.fn() }) }))

afterEach(() => vi.unstubAllGlobals())

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
  // Ringkasan (data asli, tanpa jumbotron) diperiksa di test Ringkasan di bawah.
  it.each([
    ['Antrean', <AntreanView key="a" />, '.pg-urgent', false],
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

  it('Ringkasan (data asli): sorotan komplain di atas, sebaran jenis menyaring poin, tombol Per percakapan', async () => {
    const fn = stubSummaryFetch()
    show(<RingkasanView />)
    await waitFor(() => expect(document.querySelector('#v-ringkasan .pg-urgent')?.textContent).toMatch(/komplain.*Lukas B\./))
    expect(document.querySelector('.db-hero')).toBeNull()
    expect(document.querySelector('.pg-urgent a.btn')?.getAttribute('href')).toBe('/inbox?conversation=c2&message=m7')
    expect(document.querySelector('.pg-urgent .nx')?.textContent).toContain('1 janji tim belum ditepati')
    expect(document.querySelector('.r-meta')?.textContent).toMatch(/^9 percakapan aktif · dibuat 00[.:]04$/)
    expect(document.querySelectorAll('#r-pts .item')).toHaveLength(3)
    fireEvent.click(within(document.getElementById('r-chips')!).getByText('komplain').closest('button')!)
    const pts = document.querySelectorAll('#r-pts .item')
    expect(pts).toHaveLength(1)
    expect(pts[0].textContent).toContain('Lukas B.')
    fireEvent.click(screen.getByText(/^Per percakapan/))
    expect(document.querySelectorAll('#r-chats details')).toHaveLength(2)
    expect(document.getElementById('r-pts')).toBeNull()

    // ganti hari → memuat tanggal itu
    fireEvent.change(document.getElementById('r-dsel')!, { target: { value: '2026-11-23' } })
    await waitFor(() => expect(fn.mock.calls.some(([u]) => String(u) === '/api/daily-summary?date=2026-11-23')).toBe(true))
  })

  it('Ringkasan: saran AI + Ingatkan (reminder) dan Lepas memakai item antrean live', async () => {
    const fn = stubSummaryFetch()
    show(<RingkasanView />)
    await waitFor(() => expect(document.querySelector('.pg-urgent .saran .saran-t')?.textContent).toBe('Minta maaf dan tawarkan jemput ulang'))
    // Lukas tanpa item antrean: saran tampil, tanpa Ingatkan/Lepas
    expect(within(document.querySelector('.pg-urgent') as HTMLElement).queryByText('Ingatkan')).toBeNull()
    const emma = Array.from(document.querySelectorAll('#r-pts .item')).filter((e) => e.textContent?.includes('Emma R.'))
    expect(emma).toHaveLength(2)
    expect(emma[0].querySelector('.saran .saran-k')?.textContent).toBe('Saran tindakan')
    expect(emma[0].querySelector('.saran .saran-t')?.textContent).toBe('Kirim invoice hari ini')
    expect(emma[1].querySelector('.saran')).toBeNull()

    fireEvent.click(within(emma[0] as HTMLElement).getByText('Ingatkan'))
    fireEvent.click(screen.getByText('Jadwalkan'))
    await waitFor(() => expect(fn.mock.calls.some(([u]) => String(u) === '/api/summary-items/i1/schedule')).toBe(true))
    const [, init] = fn.mock.calls.find(([u]) => String(u) === '/api/summary-items/i1/schedule')!
    const body = JSON.parse(String((init as RequestInit).body))
    expect(body.note).toBe('Kirim invoice hari ini')
    expect(body.dueAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:00\+07:00$/)

    fireEvent.click(within(emma[0] as HTMLElement).getByText('Lepas'))
    fireEvent.click(within(document.querySelector('.msheet') as HTMLElement).getByText('Lepas'))
    await waitFor(() => expect(fn.mock.calls.some(([u]) => String(u) === '/api/summary-items/i1/drop')).toBe(true))
  })

  it('Ringkasan: admin membuat ulang lewat POST generate; non-admin tanpa tombol', async () => {
    const fn = stubSummaryFetch()
    const { unmount } = show(<RingkasanView />)
    const btn = await screen.findByText('Buat ulang', { selector: '.r-regen' })
    fireEvent.click(btn)
    await waitFor(() => expect(fn.mock.calls.some(([u, i]) => String(u) === '/api/daily-summary/generate' && (i as RequestInit | undefined)?.method === 'POST' && (i as RequestInit).body === JSON.stringify({ date: '2026-11-24' }))).toBe(true))
    unmount()

    stubSummaryFetch(undefined, 'AGENT')
    show(<RingkasanView />)
    await waitFor(() => expect(document.querySelector('.pg-urgent')).not.toBeNull())
    await act(async () => {})
    expect(document.querySelector('.r-regen')).toBeNull()
    expect(document.querySelector('.rfab')).toBeNull()
  })

  it('Laporan: lead dikelompokkan, yang menunggu balasan kita lebih dulu', async () => {
    stubReportFetch()
    show(<LaporanView />)
    await waitFor(() => expect(document.querySelectorAll('#l-leads .pg-sec').length).toBeGreaterThan(0))
    const secs = Array.from(document.querySelectorAll('#l-leads .pg-sec')).map((e) => e.textContent)
    expect(secs[0]).toMatch(/^Menunggu balasan kita/)
    // follow-up di kotak saran, terpisah dari konteks lead
    const lead = document.querySelector('#l-leads .l-lead')!
    expect(lead.querySelector('.saran .saran-k')?.textContent).toBe('Follow-up')
    expect(lead.querySelector('.saran .saran-t')?.textContent).toBe('Jawab soal jemput')
    expect(lead.querySelector('.l-lt')?.textContent).toBe('Tanya jemput Banyuwangi')
    expect(document.querySelectorAll('#l-trend .db-col')).toHaveLength(8)
    const first = document.querySelector('#l-bookings .l-mlist .item')!
    expect(first.textContent).toMatch(/Chat \d+ \w+ → booking \d+ \w+ · (hari sama|\d+ hari)/)
  })

  it('Laporan: badge channel JVTO biru, Klook oranye, channel lain netral', async () => {
    const report = sampleReport()
    const b = report.bookings[0]
    report.bookings.push({ ...b, conversationId: b.conversationId + '-k', orderChannel: 'Klook' }, { ...b, conversationId: b.conversationId + '-t', orderChannel: 'TWT' })
    stubReportFetch(report)
    show(<LaporanView />)
    await waitFor(() => expect(document.querySelectorAll('#l-bookings .l-mlist .item').length).toBe(3))
    const badge = (ch: string) => Array.from(document.querySelectorAll('#l-bookings .l-mlist .item span')).find((e) => e.textContent === ch)!
    expect(badge('JVTO').className).toBe('lb lb-jvto')
    expect(badge('Klook').className).toBe('lb lb-klook')
    expect(badge('TWT').className).toBe('pill neu')
  })
})

describe('CSS /new', () => {
  // Animasi masuk halaman yang menahan transform (fill both/forwards) membuat setiap anak .view jadi
  // konteks tumpukan; panel info Inbox (fixed, z 60) lalu terkurung di bawah scrim (z 55) dan redup.
  it('animasi masuk .view.fx>* tidak menahan transform setelah selesai', () => {
    const css = readFileSync(join(process.cwd(), 'src/app/new/new.css'), 'utf8')
    const rule = /\.view\.fx>\*\{animation:([^}]*)\}/.exec(css)
    expect(rule).not.toBeNull()
    expect(rule![1]).not.toMatch(/\b(both|forwards)\b/)
  })
})
