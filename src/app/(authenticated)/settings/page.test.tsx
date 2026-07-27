import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import SettingsPage from './page'

// Scoped to the "Sambungkan Ulang" (relink) control only. The two admin
// sections below it each stand up their own fetch traffic; mocking them keeps
// this file focused on the relink flow rather than turning into a
// whole-page integration test.
vi.mock('@/components/settings/UserManagementSection', () => ({
  UserManagementSection: () => <div data-testid="user-management" />,
}))
vi.mock('@/components/settings/WebhookCredentialsPanel', () => ({
  WebhookCredentialsPanel: () => <div data-testid="webhook-credentials" />,
}))

const settings = {
  defaultChannel: 'OFFICIAL',
  workingHoursStart: null,
  workingHoursEnd: null,
  offHoursAutoReply: null,
  botKillSwitch: false,
  catalogSyncedAt: null,
}

// Unofficial disconnected + ADMIN role are what make the relink button render
// at all (see the Status nomor card).
function mockFetch(relinkResponse: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/settings') return Promise.resolve({ ok: true, json: async () => settings })
      if (url === '/api/numbers/status')
        return Promise.resolve({ ok: true, json: async () => ({ officialTokenValid: true, unofficialConnected: false }) })
      if (url === '/api/bot/gate-status')
        return Promise.resolve({ ok: true, json: async () => ({ readyForApproval: true, blocking: [] }) })
      if (url === '/api/session') return Promise.resolve({ ok: true, json: async () => ({ role: 'ADMIN' }) })
      if (url === '/api/numbers/relink' && init?.method === 'POST') {
        return typeof relinkResponse === 'function' ? (relinkResponse as () => unknown)() : relinkResponse
      }
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })
  )
}

beforeEach(() => vi.unstubAllGlobals())
afterEach(() => cleanup())

const ERROR_COPY = 'Gagal menyambungkan ulang — periksa wa-coexist'

describe('SettingsPage — Sambungkan Ulang', () => {
  it('shows an inline error when the relink endpoint responds with a non-ok status', async () => {
    mockFetch(Promise.resolve({ ok: false, status: 502, json: async () => ({ error: ERROR_COPY }) }))

    render(<SettingsPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Sambungkan Ulang' }))

    expect(await screen.findByText(ERROR_COPY)).toBeInTheDocument()
  })

  it('shows an inline error when the relink request throws outright', async () => {
    mockFetch(() => Promise.reject(new Error('Network error')))

    render(<SettingsPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Sambungkan Ulang' }))

    expect(await screen.findByText(ERROR_COPY)).toBeInTheDocument()
  })

  it('shows no error and refreshes the number status on a successful relink', async () => {
    mockFetch(Promise.resolve({ ok: true, json: async () => ({ ok: true }) }))

    render(<SettingsPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Sambungkan Ulang' }))

    await waitFor(() => {
      expect(vi.mocked(fetch).mock.calls.filter(([url]) => url === '/api/numbers/status')).toHaveLength(2)
    })
    expect(screen.queryByText(ERROR_COPY)).not.toBeInTheDocument()
  })

  // A relink re-pairs the live company-wide WhatsApp session; firing several
  // concurrently because the button stayed clickable is a real hazard.
  it('disables the button while a relink is in flight', async () => {
    let release: (value: unknown) => void = () => {}
    mockFetch(() => new Promise((resolve) => (release = resolve)))

    render(<SettingsPage />)
    const button = await screen.findByRole('button', { name: 'Sambungkan Ulang' })
    fireEvent.click(button)

    const pending = await screen.findByRole('button', { name: 'Menyambungkan...' })
    expect(pending).toBeDisabled()
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => url === '/api/numbers/relink')).toHaveLength(1)

    release({ ok: true, json: async () => ({ ok: true }) })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sambungkan Ulang' })).not.toBeDisabled())
  })
})
