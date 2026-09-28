import { describe, it, expect, afterEach, vi } from 'vitest'
import { hasValidPushToken } from './push-auth'

afterEach(() => vi.unstubAllEnvs())
const TOKEN = 'x'.repeat(32)

describe('hasValidPushToken', () => {
  it('menerima token yang cocok', () => {
    vi.stubEnv('GMAIL_PUSH_TOKEN', TOKEN)
    expect(hasValidPushToken(new URL(`https://h/api/webhooks/gmail?token=${TOKEN}`))).toBe(true)
  })

  it('menolak token salah, token hilang, dan token dengan panjang berbeda', () => {
    vi.stubEnv('GMAIL_PUSH_TOKEN', TOKEN)
    expect(hasValidPushToken(new URL(`https://h/x?token=${'y'.repeat(32)}`))).toBe(false)
    expect(hasValidPushToken(new URL('https://h/x'))).toBe(false)
    expect(hasValidPushToken(new URL('https://h/x?token=pendek'))).toBe(false)
  })

  it('env kosong atau terlalu pendek = SELALU tolak, tidak pernah "biarkan lewat"', () => {
    vi.stubEnv('GMAIL_PUSH_TOKEN', '')
    expect(hasValidPushToken(new URL('https://h/x?token='))).toBe(false)
    vi.stubEnv('GMAIL_PUSH_TOKEN', 'pendek')
    expect(hasValidPushToken(new URL('https://h/x?token=pendek'))).toBe(false)
  })
})
