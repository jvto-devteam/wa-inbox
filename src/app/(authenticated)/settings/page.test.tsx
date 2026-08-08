import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import SettingsPage from './page'

// The two admin sections below "Status nomor" each stand up their own fetch
// traffic; mocking them keeps this file focused on the page shell rather
// than turning into a whole-page integration test.
vi.mock('@/components/settings/UserManagementSection', () => ({
  UserManagementSection: () => <div data-testid="user-management" />,
}))
vi.mock('@/components/settings/WebhookCredentialsPanel', () => ({
  WebhookCredentialsPanel: () => <div data-testid="webhook-credentials" />,
}))

const settings = { defaultChannel: 'OFFICIAL' }

function mockFetch(role: 'ADMIN' | 'AGENT', unofficialConfigured = true) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      if (url === '/api/settings') return Promise.resolve({ ok: true, json: async () => settings })
      if (url === '/api/numbers/status')
        return Promise.resolve({ ok: true, json: async () => ({ officialTokenValid: true, unofficialConfigured }) })
      if (url === '/api/session') return Promise.resolve({ ok: true, json: async () => ({ role }) })
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })
  )
}

beforeEach(() => vi.unstubAllGlobals())
afterEach(() => cleanup())

describe('SettingsPage — billing link', () => {
  it('shows a link to the conversation-cost history page for an admin', async () => {
    mockFetch('ADMIN')
    render(<SettingsPage />)

    expect(await screen.findByRole('link', { name: 'Lihat histori biaya' })).toHaveAttribute('href', '/settings/billing')
  })

  it('hides the billing link for a non-admin', async () => {
    mockFetch('AGENT')
    render(<SettingsPage />)

    await screen.findByText('Status nomor')
    expect(screen.queryByRole('link', { name: 'Lihat histori biaya' })).not.toBeInTheDocument()
  })
})

describe('SettingsPage — Status nomor', () => {
  it('shows the Unofficial badge as configured, with no relink control', async () => {
    mockFetch('ADMIN', true)
    render(<SettingsPage />)

    expect(await screen.findByText(/Unofficial: Terkonfigurasi/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Sambungkan Ulang/ })).not.toBeInTheDocument()
  })

  it('shows the Unofficial badge as unconfigured when the coexist fields are empty', async () => {
    mockFetch('ADMIN', false)
    render(<SettingsPage />)

    expect(await screen.findByText(/Unofficial: Belum diatur/)).toBeInTheDocument()
  })
})
