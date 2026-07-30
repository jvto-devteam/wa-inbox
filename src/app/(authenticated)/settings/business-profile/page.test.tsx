import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import BusinessProfilePage from './page'

const profile = {
  about: 'Halo!', address: 'Jl. Khairil Anwar', description: 'Explore East Java', email: 'hello@javavolcano-touroperator.com',
  vertical: 'TRAVEL', websites: ['http://www.javavolcano-touroperator.com'], profilePictureUrl: null,
}
const account = {
  id: 'waba_1', name: 'Java Volcano Tour Operator', timezoneId: '66',
  accountReviewStatus: 'APPROVED', businessVerificationStatus: 'verified',
}
const commerce = { isCartEnabled: true, isCatalogVisible: false }

function mockFetch(overrides: { profile?: unknown; account?: unknown; commerce?: unknown } = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/settings/business-profile' && !init) {
        return Promise.resolve({ ok: true, json: async () => ({ profile: overrides.profile ?? profile, account: overrides.account ?? account }) })
      }
      if (url === '/api/settings/business-profile' && init?.method === 'PATCH') {
        return Promise.resolve({ ok: true, json: async () => ({ profile: { ...profile, about: 'Halo baru!' } }) })
      }
      if (url === '/api/settings/commerce' && !init) {
        return Promise.resolve({ ok: true, json: async () => overrides.commerce ?? commerce })
      }
      if (url === '/api/settings/commerce' && init?.method === 'PATCH') {
        return Promise.resolve({ ok: true, json: async () => ({ ...commerce, isCartEnabled: false }) })
      }
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })
  )
}

beforeEach(() => vi.unstubAllGlobals())
afterEach(() => cleanup())

describe('BusinessProfilePage', () => {
  it('shows the account status, profile fields, and commerce toggles', async () => {
    mockFetch()
    render(<BusinessProfilePage />)

    expect(await screen.findByText('Java Volcano Tour Operator')).toBeInTheDocument()
    expect(screen.getByText('Review: APPROVED')).toBeInTheDocument()
    expect(screen.getByText('Verifikasi: verified')).toBeInTheDocument()
    expect(screen.getByLabelText('About (maks. 139 karakter)')).toHaveValue('Halo!')
    expect(screen.getByLabelText('Aktifkan keranjang belanja')).toBeChecked()
    expect(screen.getByLabelText('Aktifkan katalog produk terlihat')).not.toBeChecked()
  })

  it('saves an edited profile field', async () => {
    mockFetch()
    render(<BusinessProfilePage />)

    await screen.findByLabelText('About (maks. 139 karakter)')
    fireEvent.change(screen.getByLabelText('About (maks. 139 karakter)'), { target: { value: 'Halo baru!' } })
    fireEvent.click(screen.getByText('Simpan Profil'))

    await waitFor(() => expect(screen.getByText('Profil bisnis tersimpan.')).toBeInTheDocument())
    expect(fetch).toHaveBeenCalledWith(
      '/api/settings/business-profile',
      expect.objectContaining({ method: 'PATCH', body: expect.stringContaining('Halo baru!') })
    )
  })

  it('shows an inline error when saving the profile fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        if (url === '/api/settings/business-profile' && init?.method === 'PATCH') {
          return Promise.resolve({ ok: false, json: async () => ({ error: 'Invalid parameter' }) })
        }
        if (url === '/api/settings/business-profile') return Promise.resolve({ ok: true, json: async () => ({ profile, account }) })
        if (url === '/api/settings/commerce') return Promise.resolve({ ok: true, json: async () => commerce })
        return Promise.resolve({ ok: true, json: async () => ({}) })
      })
    )
    render(<BusinessProfilePage />)

    await screen.findByText('Simpan Profil')
    fireEvent.click(screen.getByText('Simpan Profil'))

    expect(await screen.findByText('Invalid parameter')).toBeInTheDocument()
  })

  it('toggles a commerce flag immediately on click', async () => {
    mockFetch()
    render(<BusinessProfilePage />)

    await screen.findByLabelText('Aktifkan keranjang belanja')
    fireEvent.click(screen.getByLabelText('Aktifkan keranjang belanja'))

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        '/api/settings/commerce',
        expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ isCartEnabled: false }) })
      )
    )
  })

  it('shows an inline error when the initial load fails', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, json: async () => ({ error: 'nope' }) })))
    render(<BusinessProfilePage />)

    expect(await screen.findByText('Gagal memuat profil bisnis dari Meta')).toBeInTheDocument()
  })
})
