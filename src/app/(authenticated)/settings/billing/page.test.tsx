import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import BillingPage from './page'

const report = {
  currency: 'USD',
  totalCost: 2.9,
  byCategory: [
    { category: 'MARKETING', cost: 2.5, conversationCount: 5 },
    { category: 'SERVICE', cost: 0.4, conversationCount: 5 },
  ],
  daily: [
    { date: '2026-07-01', cost: 1.9 },
    { date: '2026-07-02', cost: 1.0 },
  ],
}

function mockFetch(overrideReport: unknown = report) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      if (url.startsWith('/api/analytics/conversation-cost')) return Promise.resolve({ ok: true, json: async () => overrideReport })
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })
  )
}

beforeEach(() => vi.unstubAllGlobals())
afterEach(() => cleanup())

describe('BillingPage', () => {
  it('shows the total cost, category breakdown, and daily breakdown', async () => {
    mockFetch()
    render(<BillingPage />)

    expect(await screen.findByText('$2.90')).toBeInTheDocument()
    expect(screen.getByText('Marketing')).toBeInTheDocument()
    expect(screen.getByText('Service (gratis)')).toBeInTheDocument()
    expect(screen.getByText('$2.50')).toBeInTheDocument()
    expect(screen.getByText('$0.40')).toBeInTheDocument()
  })

  it('defaults to a 30-day request and refetches with the new range when changed', async () => {
    mockFetch()
    render(<BillingPage />)

    await screen.findByText('$2.90')
    expect(fetch).toHaveBeenCalledWith('/api/analytics/conversation-cost?days=30')

    fireEvent.change(screen.getByLabelText('Rentang'), { target: { value: '7' } })

    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/analytics/conversation-cost?days=7'))
  })

  it('shows an inline error when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, json: async () => ({ error: 'nope' }) })))
    render(<BillingPage />)

    expect(await screen.findByText('Gagal memuat histori biaya dari Meta')).toBeInTheDocument()
  })

  it('shows an empty state when there is no cost data in range', async () => {
    mockFetch({ currency: 'USD', totalCost: 0, byCategory: [], daily: [] })
    render(<BillingPage />)

    expect(await screen.findByText('Tidak ada percakapan berbayar pada rentang ini.')).toBeInTheDocument()
    expect(screen.getByText('Tidak ada data pada rentang ini.')).toBeInTheDocument()
  })
})
