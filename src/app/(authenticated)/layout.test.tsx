import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import AuthenticatedLayout from './layout'

class FakeEventSource {
  static instances: FakeEventSource[] = []
  static urls: string[] = []
  onmessage: ((event: MessageEvent) => void) | null = null
  close = vi.fn()
  constructor(url: string) {
    FakeEventSource.instances.push(this)
    FakeEventSource.urls.push(url)
  }
}

const requestPermission = vi.fn(() => Promise.resolve('granted' as NotificationPermission))

beforeEach(() => {
  FakeEventSource.instances = []
  FakeEventSource.urls = []
  requestPermission.mockClear()
  vi.stubGlobal('EventSource', FakeEventSource)
  vi.stubGlobal('Notification', Object.assign(vi.fn(), { permission: 'default', requestPermission }))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const appDir = path.join(process.cwd(), 'src', 'app')

// NotificationListener used to live in the ROOT layout, so it mounted on /login too — a
// public path per middleware's PUBLIC_PATHS, while /api/sse is not. Its EventSource got a
// 401 there and, with no onerror handler, the browser retried forever against an endpoint
// that cannot succeed until the user signs in; it also asked for notification permission
// before anyone had logged in.
//
// The fix is structural rather than a pathname check inside the component, so these tests
// assert the structure: the listener is wired to the authenticated route group, and the
// login screen is outside that group and therefore cannot reach it.
describe('authenticated route group', () => {
  it('opens the SSE subscription and asks for notification permission on authenticated pages', () => {
    render(<AuthenticatedLayout>{<div>halaman</div>}</AuthenticatedLayout>)

    expect(FakeEventSource.urls).toEqual(['/api/sse'])
    expect(requestPermission).toHaveBeenCalled()
  })

  it('still renders the page it wraps', () => {
    const { getByText } = render(<AuthenticatedLayout>{<div>halaman</div>}</AuthenticatedLayout>)

    expect(getByText('halaman')).toBeInTheDocument()
  })

  it('keeps /login outside the authenticated group, so nothing there can mount the listener', () => {
    // If /login were ever moved into the group it would inherit this layout — and with it the
    // EventSource that 401-loops for an unauthenticated visitor.
    expect(existsSync(path.join(appDir, 'login', 'page.tsx'))).toBe(true)
    expect(existsSync(path.join(appDir, '(authenticated)', 'login'))).toBe(false)
  })

  it('does not mount NotificationListener from the root layout', () => {
    const rootLayout = readFileSync(path.join(appDir, 'layout.tsx'), 'utf-8')

    // A root-layout mount reaches every page, public ones included — the original bug.
    expect(rootLayout).not.toMatch(/<NotificationListener/)
    expect(rootLayout).not.toMatch(/^import .*NotificationListener/m)
  })

  it('covers every authenticated top-level route with the group', () => {
    for (const route of ['dashboard', 'inbox', 'contacts', 'settings', 'templates']) {
      expect(existsSync(path.join(appDir, '(authenticated)', route))).toBe(true)
      expect(existsSync(path.join(appDir, route))).toBe(false)
    }
  })
})
