import { describe, it, expect } from 'vitest'
import { SERVICE_WINDOW_MS, followUpNeedsTemplate, followUpWindowWarning, lastInboundAt } from './service-window'

const NOW = new Date('2026-10-19T10:00:00.000Z')
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString()

describe('lastInboundAt', () => {
  it('mengambil pesan INBOUND paling akhir, melewati pesan keluar sesudahnya', () => {
    expect(
      lastInboundAt([
        { direction: 'INBOUND', createdAt: 'a' },
        { direction: 'INBOUND', createdAt: 'b' },
        { direction: 'OUTBOUND', createdAt: 'c' },
      ])
    ).toBe('b')
  })

  it('null kalau pelanggan belum pernah menulis', () => {
    expect(lastInboundAt([{ direction: 'OUTBOUND', createdAt: 'c' }])).toBeNull()
    expect(lastInboundAt([])).toBeNull()
  })
})

describe('followUpNeedsTemplate', () => {
  it('WhatsApp + Official + jendela tertutup = template', () => {
    expect(followUpNeedsTemplate({ platform: 'WHATSAPP', channel: 'OFFICIAL', lastInboundAt: ago(SERVICE_WINDOW_MS), now: NOW })).toBe(true)
    expect(followUpNeedsTemplate({ platform: null, channel: 'OFFICIAL', lastInboundAt: null, now: NOW })).toBe(true)
  })

  it('jendela masih terbuka = tidak perlu template', () => {
    expect(followUpNeedsTemplate({ platform: 'WHATSAPP', channel: 'OFFICIAL', lastInboundAt: ago(SERVICE_WINDOW_MS - 1), now: NOW })).toBe(false)
  })

  it('Unofficial tidak bisa membawa template (matriks kanal) = tidak perlu template', () => {
    expect(followUpNeedsTemplate({ platform: 'WHATSAPP', channel: 'UNOFFICIAL', lastInboundAt: null, now: NOW })).toBe(false)
  })

  it('platform selain WhatsApp = tidak perlu template', () => {
    for (const platform of ['EMAIL', 'FACEBOOK', 'INSTAGRAM']) {
      expect(followUpNeedsTemplate({ platform, channel: 'OFFICIAL', lastInboundAt: null, now: NOW })).toBe(false)
    }
  })
})

describe('followUpWindowWarning', () => {
  it('Facebook/Instagram dengan jendela tertutup = peringatan', () => {
    for (const platform of ['FACEBOOK', 'INSTAGRAM']) {
      expect(followUpWindowWarning({ platform, lastInboundAt: ago(SERVICE_WINDOW_MS), now: NOW })).toBe(true)
      expect(followUpWindowWarning({ platform, lastInboundAt: null, now: NOW })).toBe(true)
    }
  })

  it('jendela terbuka, atau platform WhatsApp/Email = tanpa peringatan', () => {
    expect(followUpWindowWarning({ platform: 'FACEBOOK', lastInboundAt: ago(SERVICE_WINDOW_MS - 1), now: NOW })).toBe(false)
    for (const platform of ['WHATSAPP', 'EMAIL', null]) {
      expect(followUpWindowWarning({ platform, lastInboundAt: null, now: NOW })).toBe(false)
    }
  })
})
