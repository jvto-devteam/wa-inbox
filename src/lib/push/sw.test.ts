/** @vitest-environment node */
/**
 * public/sw.js (owner 2026-11-27: notif HP harus muncul baik saat aplikasi tertutup/di latar maupun sedang dibuka).
 * Handler `push` selalu memanggil showNotification -- tidak pernah memeriksa apakah ada jendela yang sedang fokus.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

type Listener = (event: { data?: { json: () => unknown }; waitUntil: (p: Promise<unknown>) => void }) => void

function loadSw(windows: { url: string; focused: boolean; visibilityState: string }[]) {
  const listeners: Record<string, Listener> = {}
  const showNotification = vi.fn().mockResolvedValue(undefined)
  const self = {
    addEventListener: (type: string, fn: Listener) => { listeners[type] = fn },
    registration: { showNotification },
    clients: { matchAll: vi.fn().mockResolvedValue(windows), claim: vi.fn(), openWindow: vi.fn() },
    location: { origin: 'https://wa-inbox.example' },
  }
  runInNewContext(readFileSync(join(process.cwd(), 'public/sw.js'), 'utf8'), { self, URL })
  return { listeners, showNotification }
}

async function firePush(listeners: Record<string, Listener>, payload: unknown) {
  const waits: Promise<unknown>[] = []
  listeners.push({ data: { json: () => payload }, waitUntil: (p) => waits.push(p) })
  await Promise.all(waits)
}

const payload = { title: 'Belum dibalas: Sophie', body: 'Menunggu balasan sejak 10.05 WIB', url: '/inbox?conversation=c1', tag: 'summary-item:i1' }

describe('service worker push', () => {
  it.each([
    ['latar belakang / aplikasi tertutup', []],
    ['latar depan (jendela wa-inbox sedang dibuka dan fokus)', [{ url: 'https://wa-inbox.example/inbox', focused: true, visibilityState: 'visible' }]],
  ])('%s: notifikasi tetap ditampilkan', async (_label, windows) => {
    const { listeners, showNotification } = loadSw(windows)
    await firePush(listeners, payload)
    expect(showNotification).toHaveBeenCalledWith('Belum dibalas: Sophie', expect.objectContaining({ body: payload.body, tag: payload.tag, data: { url: payload.url } }))
  })

  it('payload rusak tetap menampilkan notifikasi umum', async () => {
    const { listeners, showNotification } = loadSw([])
    const waits: Promise<unknown>[] = []
    listeners.push({ data: { json: () => { throw new Error('bukan json') } }, waitUntil: (p) => waits.push(p) })
    await Promise.all(waits)
    expect(showNotification).toHaveBeenCalledWith('wa-inbox', expect.objectContaining({ data: { url: '/inbox' } }))
  })
})
