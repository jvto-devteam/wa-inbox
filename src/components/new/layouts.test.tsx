import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { sampleReport, stubReportFetch } from './__fixtures__/report'
import { stubSummaryFetch } from './__fixtures__/summary'
import { stubQueueFetch } from './__fixtures__/antrean'
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

  it('Antrean (data asli): paling mendesak = Belum dibalas tertua, tab per jenis, aksi memakai route antrean', async () => {
    const fn = stubQueueFetch()
    show(<AntreanView />)
    await waitFor(() => expect(document.querySelector('.pg-urgent')?.textContent).toContain('Sarah M.'))
    const urgent = document.querySelector('.pg-urgent') as HTMLElement
    expect(urgent.textContent).toContain('Menunggu 3 jam')
    expect(urgent.querySelector('.saran-t')?.textContent).toBe('Konfirmasi jam jemput 05.00')
    expect(within(urgent).getByText('Balas sekarang').getAttribute('href')).toBe('/inbox?conversation=c-a&message=m-a')
    expect(urgent.querySelector('.nx')?.textContent).toContain('Ben C.')
    expect(Array.from(document.querySelectorAll('#a-tabs button')).map((b) => b.textContent)).toEqual(['Balas2', 'Follow Up1', 'Janji Admin1', 'Reminder2'].map((t) => t.replace(/(\d)$/, ' $1')))

    // Lepas (dikonfirmasi) → drop
    const ben = Array.from(document.querySelectorAll('#a-list .item')).find((e) => e.textContent?.includes('Ben C.')) as HTMLElement
    fireEvent.click(within(ben).getByText('Lepas'))
    fireEvent.click(within(document.querySelector('.msheet') as HTMLElement).getByText('Lepas'))
    await waitFor(() => expect(fn.mock.calls.some(([u, i]) => String(u) === '/api/summary-items/b/drop' && (i as RequestInit | undefined)?.method === 'POST')).toBe(true))

    // Ingatkan → schedule dengan catatan = saran
    fireEvent.click(within(urgent).getByText('Ingatkan'))
    fireEvent.click(screen.getByText('Jadwalkan'))
    await waitFor(() => expect(fn.mock.calls.some(([u]) => String(u) === '/api/summary-items/a/schedule')).toBe(true))
    const [, init] = fn.mock.calls.find(([u]) => String(u) === '/api/summary-items/a/schedule')! as unknown as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toMatchObject({ note: 'Konfirmasi jam jemput 05.00' })

    // Reminder: reminder kontak tanpa item → Tunda lewat PATCH dueAt, Selesai lewat PATCH done
    fireEvent.click(within(document.getElementById('a-tabs')!).getByText('Reminder').closest('button')!)
    expect(document.getElementById('a-list')?.textContent).toContain('Cek mutasi pembayaran')
    const hana = Array.from(document.querySelectorAll('#a-list .item')).find((e) => e.textContent?.includes('Hana Y.')) as HTMLElement
    expect(hana.textContent).toMatch(/Lewat · /)
    expect(within(hana).queryByText('Buka chat')).toBeNull()
    const mei = Array.from(document.querySelectorAll('#a-list .item')).find((e) => e.textContent?.includes('Mei H.')) as HTMLElement
    fireEvent.click(within(mei).getByText('Tunda'))
    fireEvent.click(screen.getByText('Jadwalkan'))
    await waitFor(() => expect(fn.mock.calls.some(([u, i]) => String(u) === '/api/contacts/k1/reminders' && JSON.parse(String((i as RequestInit).body)).dueAt)).toBe(true))
    fireEvent.click(within(mei).getByText('Selesai'))
    await waitFor(() => expect(fn.mock.calls.some(([u, i]) => String(u) === '/api/contacts/k1/reminders' && JSON.parse(String((i as RequestInit).body)).done === true)).toBe(true))
    // Hana punya item antrean → Tunda lewat schedule
    fireEvent.click(within(hana).getByText('Tunda'))
    fireEvent.click(screen.getByText('Jadwalkan'))
    await waitFor(() => expect(fn.mock.calls.some(([u]) => String(u) === '/api/summary-items/i9/schedule')).toBe(true))
  })

  it('Ringkasan (data asli): sorotan komplain di atas, sebaran jenis menyaring poin, tombol Per percakapan', async () => {
    const fn = stubSummaryFetch()
    show(<RingkasanView />)
    await waitFor(() => expect(document.querySelector('#v-ringkasan .pg-urgent')?.textContent).toMatch(/komplain.*Lukas B\./))
    expect(document.querySelector('.db-hero')).toBeNull()
    expect(document.querySelector('.pg-urgent a.btn')?.getAttribute('href')).toBe('/inbox?conversation=c2&message=m7')
    expect(document.querySelector('.pg-urgent .nx')?.textContent).toContain('1 janji tim belum ditepati')
    expect(document.querySelector('.r-meta')?.textContent).toMatch(/^Dibuat 00[.:]04$/)
    expect(document.querySelector('#r-pts .hint')).toBeNull()
    // tombol = jumlah percakapan di daftarnya (bukan hanya yang perlu tindakan)
    expect(screen.getByText(/^Per percakapan/).textContent).toBe('Per percakapan 2')
    expect(document.querySelectorAll('#r-pts .item')).toHaveLength(3)
    fireEvent.click(within(document.getElementById('r-chips')!).getByText('komplain').closest('button')!)
    const pts = document.querySelectorAll('#r-pts .item')
    expect(pts).toHaveLength(1)
    expect(pts[0].textContent).toContain('Lukas B.')
    fireEvent.click(screen.getByText(/^Per percakapan/))
    expect(document.querySelectorAll('#r-chats details')).toHaveLength(2)
    expect(Array.from(document.querySelectorAll('#r-chats .pg-sec')).map((e) => e.textContent)).toEqual(['Aktif hari itu 1', 'Masih menggantung · tidak ada pesan baru 1'])
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

  it('Laporan: tidak berhenti di bacaan -- alasan menyaring lead, lead punya Buka chat + Ingatkan, minggu tren membuka periode', async () => {
    const fn = stubReportFetch()
    show(<LaporanView />)
    await waitFor(() => expect(document.querySelectorAll('#l-leads .l-lead')).toHaveLength(2))

    // alasan → saring lead; klik lagi / "Tampilkan semua" melepas
    fireEvent.click(within(document.getElementById('l-blockers')!).getByText('Harga / budget').closest('.l-blk')!)
    expect(document.querySelectorAll('#l-leads .l-lead')).toHaveLength(1)
    expect(document.querySelector('#l-leads .l-filter')?.textContent).toContain('Harga / budget')
    fireEvent.click(screen.getByText('Tampilkan semua'))
    expect(document.querySelectorAll('#l-leads .l-lead')).toHaveLength(2)

    // lead yang menunggu balasan kita: tombol utama "Balas di chat" ke Inbox
    const first = document.querySelector('#l-leads .l-lead')!
    expect(within(first as HTMLElement).getByText('Balas di chat').getAttribute('href')).toBe('/inbox?conversation=c')

    // Ingatkan follow-up → reminder kontak berisi follow-up
    fireEvent.click(within(first as HTMLElement).getByText('Ingatkan follow-up'))
    fireEvent.click(screen.getByText('Jadwalkan'))
    await waitFor(() => expect(fn.mock.calls.some(([u]) => String(u) === '/api/contacts/ct-c/reminders')).toBe(true))
    const [, init] = fn.mock.calls.find(([u]) => String(u) === '/api/contacts/ct-c/reminders')! as unknown as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toMatchObject({ note: 'Follow-up: Jawab soal jemput' })

    // minggu di tren → laporan minggu itu
    const cols = document.querySelectorAll('#l-trend .db-col')
    fireEvent.click(cols[0])
    await waitFor(() => expect((screen.getByLabelText('Pilih periode') as HTMLSelectElement).value).toMatch(/^w:\d{4}-\d\d-\d\d$/))
    const mon = (screen.getByLabelText('Pilih periode') as HTMLSelectElement).value.slice(2)
    await waitFor(() => expect(fn.mock.calls.some(([u]) => String(u).startsWith('/api/new/report?from=' + mon + '&to='))).toBe(true))
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
