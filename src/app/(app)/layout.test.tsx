import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

vi.mock('next/font/google', () => ({ Figtree: () => ({ variable: 'font-figtree' }) }))
vi.mock('next/navigation', () => ({ usePathname: () => '/dashboard', useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }))

import AppLayout from './layout'

class FakeEventSource {
  static urls: string[] = []
  onmessage: ((event: MessageEvent) => void) | null = null
  close = vi.fn()
  constructor(url: string) { FakeEventSource.urls.push(url) }
}
const requestPermission = vi.fn(() => Promise.resolve('granted' as NotificationPermission))

beforeEach(() => {
  FakeEventSource.urls = []
  requestPermission.mockClear()
  vi.stubGlobal('EventSource', FakeEventSource)
  vi.stubGlobal('Notification', Object.assign(vi.fn(), { permission: 'default', requestPermission }))
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })))
  window.matchMedia = ((q: string) => ({
    matches: false, media: q, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const appDir = path.join(process.cwd(), 'src', 'app')

// Grup (app) = aplikasi utama di root. Yang dijaga sama dengan grup lama (authenticated): langganan SSE notifikasi hanya
// hidup di halaman bersesi, /login di luar grup, dan layout root tidak memasangnya.
describe('grup aplikasi (app)', () => {
  it('membuka langganan SSE notifikasi tanpa meminta izin notifikasi otomatis, dan tetap menggambar halamannya', () => {
    const { getByText } = render(<AppLayout><div>halaman</div></AppLayout>)
    expect(FakeEventSource.urls).toEqual(['/api/sse'])
    expect(requestPermission).not.toHaveBeenCalled()
    expect(getByText('halaman')).toBeInTheDocument()
  })

  it('/login di luar grup; layout root tidak memasang NotificationListener', () => {
    expect(existsSync(path.join(appDir, 'login', 'page.tsx'))).toBe(true)
    expect(existsSync(path.join(appDir, '(app)', 'login'))).toBe(false)
    const rootLayout = readFileSync(path.join(appDir, 'layout.tsx'), 'utf-8')
    expect(rootLayout).not.toMatch(/<NotificationListener/)
  })

  it('setiap halaman bersesi ada di grup, bukan di root; grup lama dan /new tidak ada lagi', () => {
    for (const route of ['dashboard', 'inbox', 'antrean', 'ringkasan', 'laporan', 'agent', 'kontak', 'template', 'templates', 'bot', 'bot-control', 'settings', 'ai-office']) {
      expect(existsSync(path.join(appDir, '(app)', route, 'page.tsx')), route).toBe(true)
      expect(existsSync(path.join(appDir, route)), route).toBe(false)
    }
    expect(existsSync(path.join(appDir, '(authenticated)'))).toBe(false)
    expect(existsSync(path.join(appDir, 'new'))).toBe(false)
  })
})
