import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { NotificationListener } from './NotificationListener'

const subscribe = vi.fn()
const getSubscription = vi.fn()
const register = vi.fn()
let permission: NotificationPermission
const requestPermission = vi.fn()
const fetchMock = vi.fn()

class FakeES { onmessage: unknown; close = vi.fn() }

beforeEach(() => {
  permission = 'default'
  subscribe.mockReset().mockResolvedValue({ toJSON: () => ({ endpoint: 'https://push.example/x', keys: { p256dh: 'pk', auth: 'ak' } }) })
  getSubscription.mockReset().mockResolvedValue(null)
  register.mockReset().mockResolvedValue({})
  requestPermission.mockReset().mockImplementation(async () => { permission = 'granted'; return 'granted' })
  fetchMock.mockReset().mockImplementation(async (url: string) =>
    url.includes('vapid') ? { ok: true, json: async () => ({ publicKey: 'BAQBAQ' }) } : { ok: true, json: async () => ({ ok: true }) })
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('EventSource', FakeES)
  const NotificationStub = function () {} as unknown as { requestPermission: typeof requestPermission }
  NotificationStub.requestPermission = requestPermission
  Object.defineProperty(NotificationStub, 'permission', { get: () => permission })
  vi.stubGlobal('Notification', NotificationStub)
  vi.stubGlobal('PushManager', function () {})
  Object.defineProperty(window, 'PushManager', { value: function () {}, configurable: true })
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { register, ready: Promise.resolve({ pushManager: { getSubscription, subscribe } }) },
  })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('NotificationListener push', () => {
  it('registers /sw.js and does NOT ask permission on load', async () => {
    render(<NotificationListener />)
    await screen.findByRole('button', { name: 'Nyalakan notifikasi' })
    expect(register).toHaveBeenCalledWith('/sw.js')
    expect(requestPermission).not.toHaveBeenCalled()
  })

  it('click asks permission, subscribes and posts the subscription', async () => {
    render(<NotificationListener />)
    fireEvent.click(await screen.findByRole('button', { name: 'Nyalakan notifikasi' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/push/subscribe', expect.objectContaining({ method: 'POST' })))
    expect(requestPermission).toHaveBeenCalledTimes(1)
    expect(subscribe).toHaveBeenCalledWith(expect.objectContaining({ userVisibleOnly: true }))
    const body = JSON.parse((fetchMock.mock.calls.find((c) => c[0] === '/api/push/subscribe')![1] as { body: string }).body)
    expect(body).toEqual({ endpoint: 'https://push.example/x', keys: { p256dh: 'pk', auth: 'ak' } })
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Nyalakan notifikasi' })).toBeNull())
  })

  it('hides the button when permission granted and a subscription exists', async () => {
    permission = 'granted'
    getSubscription.mockResolvedValue({})
    render(<NotificationListener />)
    await waitFor(() => expect(register).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 10))
    expect(screen.queryByRole('button', { name: 'Nyalakan notifikasi' })).toBeNull()
  })

  it('shows retry label when the server rejects', async () => {
    fetchMock.mockImplementation(async (url: string) => (url.includes('vapid') ? { ok: false } : { ok: true }))
    render(<NotificationListener />)
    fireEvent.click(await screen.findByRole('button', { name: 'Nyalakan notifikasi' }))
    await screen.findByRole('button', { name: 'Gagal, coba lagi' })
  })
})
