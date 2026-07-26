import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { WebhookCredentialsPanel } from './WebhookCredentialsPanel'

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('WebhookCredentialsPanel', () => {
  it('shows the Meta webhook URL derived from window.location.origin', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ coexistBaseUrl: 'http://localhost:4000', accessTokenSet: true, coexistApiKeySet: true }),
      })
    )
    render(<WebhookCredentialsPanel />)

    await waitFor(() =>
      expect(screen.getByText(`${window.location.origin}/api/webhooks/meta`)).toBeInTheDocument()
    )
  })

  it('shows the wa-coexist base URL for reference', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ coexistBaseUrl: 'http://localhost:4000', accessTokenSet: true, coexistApiKeySet: true }),
      })
    )
    render(<WebhookCredentialsPanel />)

    await screen.findByText('http://localhost:4000')
  })

  it('shows a success badge when accessToken/coexistApiKey are set, and never renders their values', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ coexistBaseUrl: 'http://localhost:4000', accessTokenSet: true, coexistApiKeySet: true }),
      })
    )
    render(<WebhookCredentialsPanel />)

    const badges = await screen.findAllByText(/Diset/)
    expect(badges.length).toBe(2)
    expect(screen.queryByText(/Belum diset/)).not.toBeInTheDocument()
  })

  it('shows a destructive badge when accessToken/coexistApiKey are not set', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ coexistBaseUrl: 'http://localhost:4000', accessTokenSet: false, coexistApiKeySet: false }),
      })
    )
    render(<WebhookCredentialsPanel />)

    const badges = await screen.findAllByText(/Belum diset/)
    expect(badges.length).toBe(2)
  })
})
