import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NewShell } from './Shell'
import { AgentView } from './views/AgentView'
import { BotView } from './views/BotView'
import { KontakView } from './views/KontakView'
import { TemplateView } from './views/TemplateView'

let path = '/new/bot'
vi.mock('next/navigation', () => ({ usePathname: () => path, useRouter: () => ({ push: vi.fn() }) }))

type Handler = (url: URL, body: unknown) => { status?: number; body: unknown }
let routes: Record<string, Handler> = {}
const calls: { method: string; url: string; body: unknown }[] = []

beforeEach(() => {
  calls.length = 0
  routes = {}
  window.matchMedia = ((q: string) => ({
    matches: false, media: q, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
  // API tiruan: kunci = "METHOD /path"; tidak ada yang menyentuh server atau database.
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input, 'http://x')
    const method = init?.method || 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ method, url: url.pathname + url.search, body })
    const h = routes[method + ' ' + url.pathname]
    const r = h ? h(url, body) : { status: 404, body: { error: 'tidak ada' } }
    const status = r.status ?? 200
    return { ok: status < 400, status, json: async () => r.body } as Response
  }))
})
afterEach(() => vi.unstubAllGlobals())

const show = (p: string, el: React.ReactNode) => { path = p; return render(<NewShell>{el}</NewShell>) }
const sheetRun = (label: string) => fireEvent.click(within(document.querySelector('.msheet') as HTMLElement).getByText(label))

const TPL = (key: string, audience: 'CUSTOMER' | 'INTERNAL', isActive = true) => ({
  id: key, key, name: 'Nama ' + key, description: null, audience, body: 'Halo {customer_name}', imageUrl: null,
  variables: [{ name: 'customer_name', required: true, example: 'John' }], isActive, updatedById: null, createdAt: '', updatedAt: '',
})

describe('Template pesan: data asli', () => {
  it('memuat dari API, menyimpan isi lewat PATCH, nonaktif minta konfirmasi', async () => {
    routes['GET /api/system-templates'] = () => ({ body: { items: [TPL('payment_reminder_balance', 'CUSTOMER'), TPL('internal_new_booking', 'INTERNAL')] } })
    routes['PATCH /api/system-templates/payment_reminder_balance'] = (_u, b) => ({ body: { ...TPL('payment_reminder_balance', 'CUSTOMER'), ...(b as object) } })
    show('/new/template', <TemplateView />)
    await waitFor(() => expect(document.querySelector('.bt-ban b')?.textContent).toBe('2 template pesan sistem'))
    // pratinjau WhatsApp: nilai contoh terisi, format *tebal* dirender
    expect(document.querySelector('#t-list .wa-b')?.textContent).toContain('Halo John')

    fireEvent.click(screen.getByText('Nama payment_reminder_balance').closest('.tpw')!)
    fireEvent.change(screen.getByLabelText('Isi pesan'), { target: { value: 'Hai {customer_name}, sisa pembayaran' } })
    await act(async () => { fireEvent.click(screen.getByText('Simpan')) })
    expect(calls.find((c) => c.method === 'PATCH')).toMatchObject({ url: '/api/system-templates/payment_reminder_balance', body: { body: 'Hai {customer_name}, sisa pembayaran' } })

    fireEvent.click(screen.getByLabelText('Aktif: Nama internal_new_booking'))
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(1) // belum dikirim sebelum konfirmasi
    routes['PATCH /api/system-templates/internal_new_booking'] = () => ({ body: TPL('internal_new_booking', 'INTERNAL', false) })
    await act(async () => { sheetRun('Nonaktifkan') })
    expect(calls.at(-1)).toMatchObject({ method: 'PATCH', url: '/api/system-templates/internal_new_booking', body: { isActive: false } })
  })

  it('akun non-admin (403) melihat pesan "Hanya admin"', async () => {
    routes['GET /api/system-templates'] = () => ({ status: 403, body: { error: 'Forbidden' } })
    show('/new/template', <TemplateView />)
    await waitFor(() => expect(screen.getByText('Hanya admin')).toBeInTheDocument())
  })
})

describe('Kontak: data asli', () => {
  it('daftar dari /api/contacts, saring tahap, detail menulis consent lewat PUT', async () => {
    routes['GET /api/contacts'] = (u) => ({
      body: u.searchParams.get('limit') === '1'
        ? { rows: [], total: u.searchParams.get('stage') === 'booked' ? 3 : 10, page: 1, limit: 1 }
        : { rows: [{ id: 'c1', name: 'Sarah', phone: '393331112222', conversationId: 'v1', orderChannel: 'JVTO', pipelineStage: 'booked', lastContactAt: new Date().toISOString(), labels: ['VIP'] }], total: 1, page: 1, limit: 40 },
    })
    routes['GET /api/contacts/c1/notes'] = () => ({ body: [] })
    routes['GET /api/contacts/c1/reminders'] = () => ({ body: [] })
    routes['GET /api/contacts/c1/consent'] = () => ({ body: { consent: null } })
    routes['PUT /api/contacts/c1/consent'] = (_u, b) => ({ body: { consent: { optOut: (b as { optOut: boolean }).optOut, source: null, note: null, updatedAt: new Date().toISOString() } } })
    show('/new/kontak', <KontakView />)
    await waitFor(() => expect(document.querySelector('.bt-ban b')?.textContent).toBe('10 kontak'))
    expect(screen.getByText('Sarah')).toBeInTheDocument()
    expect(document.querySelector('.kt-c')?.textContent).toContain('+393331112222')

    fireEvent.click(within(document.getElementById('k-hk')!).getByText('Booked').closest('button')!)
    await waitFor(() => expect(calls.some((c) => c.url.includes('limit=40') && c.url.includes('stage=booked'))).toBe(true))

    fireEvent.click(document.querySelector('.kt-c')!)
    await waitFor(() => expect(screen.getByText('Belum pernah ditanyakan')).toBeInTheDocument())
    await act(async () => { fireEvent.click(screen.getByLabelText('Consent')) })
    expect(calls.at(-1)).toMatchObject({ method: 'PUT', url: '/api/contacts/c1/consent', body: { optOut: true } })
  })
})

describe('Bot: data asli', () => {
  const SETTINGS = { botAutoReplyAll: true, skipBotForIndonesianNumbers: true, handoffOnHumanRequest: true, fallbackReply: null, handoffReply: null, workingHoursStart: '08:00', workingHoursEnd: '20:00' }
  function base(role: 'ADMIN' | 'AGENT') {
    routes['GET /api/session'] = () => ({ body: { role, name: 'X' } })
    routes['GET /api/settings'] = () => ({ body: SETTINGS })
    routes['GET /api/bot-control/knowledge/sources'] = () => ({ body: { items: [
      { id: 'k1', title: 'Harga Bromo', status: 'PUBLISHED', summary: null, managed: true, latestRevision: { id: 'r1', version: 3, status: 'DRAFT' }, hasDraft: true },
      { id: 'k2', title: 'Jam Ijen', status: 'PUBLISHED', summary: null, managed: true, latestRevision: { id: 'r2', version: 2, status: 'PUBLISHED' }, hasDraft: false },
    ], total: 2 } })
    routes['GET /api/bot/knowledge-gaps'] = () => ({ body: [{ id: 'g1', conversationId: 'v1', contactName: 'Tom', topic: 'ijen', messageText: 'Drone boleh?', missingQuestion: null, createdAt: new Date().toISOString(), resolvedAt: null }] })
    routes['GET /api/bot-control/decisions'] = () => ({ body: { items: [], total: 17 } })
  }

  it('admin: banner dari settings, mematikan bot lewat POST /api/bot/mode sesudah konfirmasi', async () => {
    base('ADMIN')
    routes['POST /api/bot/mode'] = () => ({ body: { botAutoReplyAll: false } })
    show('/new/bot', <BotView />)
    await waitFor(() => expect(document.querySelector('.bt-ban b')?.textContent).toBe('Bot menjawab semua chat'))
    await waitFor(() => expect(within(document.getElementById('b-hk')!).getByText('17')).toBeInTheDocument())
    await waitFor(() => expect((screen.getByLabelText('Bot menjawab semua chat') as HTMLInputElement).disabled).toBe(false))
    fireEvent.click(screen.getByLabelText('Bot menjawab semua chat'))
    expect(calls.some((c) => c.method === 'POST')).toBe(false)
    await act(async () => { sheetRun('Ya, terapkan') })
    expect(calls.at(-1)).toMatchObject({ method: 'POST', url: '/api/bot/mode' })
    expect(document.querySelector('.bt-ban b')?.textContent).toBe('Bot dimatikan, tim membalas manual')
  })

  it('non-admin: sakelar dimatikan', async () => {
    base('AGENT')
    show('/new/bot', <BotView />)
    await waitFor(() => expect(document.querySelector('.bt-ban b')?.textContent).toBe('Bot menjawab semua chat'))
    expect((screen.getByLabelText('Bot menjawab semua chat') as HTMLInputElement).disabled).toBe(true)
  })

  it('Knowledge & celah dari API; simulator dry-run memanggil /api/bot-control/simulate', async () => {
    base('ADMIN')
    routes['POST /api/bot-control/simulate'] = () => ({ body: { status: 'WOULD_REPLY', reply: 'Ijen buka 01:00', warnings: [], latencyMs: 812 } })
    show('/new/bot', <BotView />)
    await waitFor(() => expect(within(document.getElementById('b-hk')!).getByText('2/2')).toBeInTheDocument())
    fireEvent.click(within(document.getElementById('b-tabs')!).getByText('Knowledge'))
    await waitFor(() => expect(screen.getByText('Drone boleh?')).toBeInTheDocument())
    expect(screen.getByText('Harga Bromo').closest('.item')?.textContent).toContain('DRAF')

    fireEvent.click(within(document.getElementById('b-tabs')!).getByText('Uji'))
    await waitFor(() => expect((screen.getByText('Coba jawab') as HTMLButtonElement).disabled).toBe(false))
    await act(async () => { fireEvent.click(screen.getByText('Coba jawab')) })
    expect(calls.at(-1)).toMatchObject({ method: 'POST', url: '/api/bot-control/simulate', body: { dryRun: true } })
    expect(document.querySelector('.log')?.textContent).toContain('Ijen buka 01:00')
  })
})

describe('Riwayat Agent: data asli', () => {
  it('memuat /api/new/agent-activity untuk hari ini, banner kuning bila ada gagal, saring status, detail', async () => {
    const t = (h: number) => { const d = new Date(); d.setHours(h, 5, 0, 0); return d.toISOString() }
    routes['GET /api/new/agent-activity'] = () => ({ body: { items: [
      { id: 'job:1', at: t(10), agent: 'reminder', status: 'ok', title: 'Pengingat pelunasan', input: 'Template payment_reminder_balance ke tamu', output: 'Terkirim', conversationId: 'c1', contact: 'Sarah' },
      { id: 'job:2', at: t(9), agent: 'crew', status: 'gagal', title: 'Reminder crew', input: 'Template crew_reminder_group ke crew', output: 'Gagal terkirim: grup tidak ada', conversationId: null, contact: null },
      { id: 'run:3', at: t(9), agent: 'balas', status: 'ok', title: 'Membalas pesan tamu', input: 'Pesan tamu: "hi"', output: 'Balasan: "hello"', conversationId: 'c2', contact: 'Tom' },
    ] } })
    show('/new/agent', <AgentView />)
    await waitFor(() => expect(document.querySelector('#v-agent .bt-ban b')?.textContent).toBe('3 aktivitas agent'))
    const q = calls.find((c) => c.url.startsWith('/api/new/agent-activity'))!
    const u = new URL(q.url, 'http://x')
    expect(new Date(u.searchParams.get('to')!).getTime() - new Date(u.searchParams.get('from')!).getTime()).toBe(864e5)
    expect(document.querySelector('#v-agent .bt-ban')?.className).toContain('warn')
    expect(Array.from(document.querySelectorAll('.ag-h')).map((e) => e.textContent)).toEqual(['10.00', '09.00'])

    fireEvent.click(within(document.getElementById('g-hk')!).getByText('Gagal').closest('button')!)
    expect(document.querySelectorAll('#g-t .ag-ev')).toHaveLength(1)
    fireEvent.click(document.querySelector('#g-t .ag-ev')!)
    expect(document.querySelector('#g-drawer')?.textContent).toContain('Gagal terkirim: grup tidak ada')
  })
})
