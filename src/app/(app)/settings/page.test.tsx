import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { SAFETY_BOUNDS, SAFETY_FIELD_LABELS } from '@/lib/outbound/safety-bounds'
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

const settings = {
  defaultChannel: 'OFFICIAL',
  campaignRatePerMinute: 20,
  duplicateWindowMs: 60_000,
  providerFailureThreshold: 5,
  providerFailureWindowMs: 300_000,
}

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

/**
 * Halaman Pengaturan sekarang punya sidebar kedua: satu bagian tampil pada satu waktu. Test
 * yang menyentuh bagian selain "Default jalur kirim" (bagian bawaan) membukanya lebih dulu,
 * persis seperti operator — bukan dengan melonggarkan assertion-nya.
 *
 * `findByRole` sekaligus menjadi barrier muatnya halaman: item admin baru muncul setelah
 * /api/session menjawab, jadi menunggunya di sini menghapus kebutuhan menunggu terpisah.
 */
async function openSection(name: string) {
  fireEvent.click(await screen.findByRole('button', { name }))
}

describe('SettingsPage — billing link', () => {
  it('shows a link to the conversation-cost history page for an admin', async () => {
    mockFetch('ADMIN')
    render(<SettingsPage />)

    await openSection('Kelola di halaman lain')
    expect(screen.getByRole('link', { name: 'Lihat histori biaya' })).toHaveAttribute('href', '/settings/billing')
  })

  it('hides the billing link for a non-admin', async () => {
    mockFetch('AGENT')
    render(<SettingsPage />)

    await screen.findByRole('heading', { name: 'Default jalur kirim' })
    // Bagi non-admin bagiannya tidak ada DI SIDEBAR sama sekali, bukan sekadar panelnya kosong:
    // item nav yang membuka panel kosong mengajarkan menu ini tidak bisa dipercaya.
    expect(screen.queryByRole('button', { name: 'Kelola di halaman lain' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Lihat histori biaya' })).not.toBeInTheDocument()
  })
})

describe('SettingsPage — Status nomor', () => {
  it('shows the Unofficial badge as configured, with no relink control', async () => {
    mockFetch('ADMIN', true)
    render(<SettingsPage />)

    await openSection('Status nomor')
    expect(screen.getByText(/Unofficial: Terkonfigurasi/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Sambungkan Ulang/ })).not.toBeInTheDocument()
  })

  it('shows the Unofficial badge as unconfigured when the coexist fields are empty', async () => {
    mockFetch('ADMIN', false)
    render(<SettingsPage />)

    await openSection('Status nomor')
    expect(screen.getByText(/Unofficial: Belum diatur/)).toBeInTheDocument()
  })
})

describe('SettingsPage — Pengaman outbound', () => {
  it('shows each safety threshold with the bounds the API will actually enforce', async () => {
    // The floors are the load-bearing half: zero on the campaign limit does not loosen it, it
    // disables the gate. An input that offers a number the route will reject teaches an operator
    // to distrust the form, so min/max come from the same constant the route validates with.
    mockFetch('ADMIN')
    render(<SettingsPage />)

    await openSection('Pengaman outbound')
    const campaign = screen.getByLabelText(SAFETY_FIELD_LABELS.campaignRatePerMinute)
    expect(campaign).toHaveAttribute('min', String(SAFETY_BOUNDS.campaignRatePerMinute.min))
    expect(campaign).toHaveAttribute('max', String(SAFETY_BOUNDS.campaignRatePerMinute.max))
    expect(campaign).toHaveValue(20)
  })

  it('offers no provider-pause control here, only a pointer to the queue page', async () => {
    // A pause is an emergency action; putting it on the same form as the thresholds is how an
    // unrelated save lifts one. The link is the whole affordance this page gives it.
    mockFetch('ADMIN')
    render(<SettingsPage />)

    await openSection('Pengaman outbound')
    expect(screen.getByRole('heading', { name: 'Pengaman outbound' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Jeda/ })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Outbound Queue' })).toHaveAttribute(
      'href',
      '/bot-control/outbound-queue'
    )
  })

  it('hides the whole card from a non-admin', async () => {
    mockFetch('AGENT')
    render(<SettingsPage />)

    await screen.findByRole('heading', { name: 'Default jalur kirim' })
    // Tidak ada panelnya, dan tidak ada pintunya di sidebar.
    expect(screen.queryByText('Pengaman outbound')).not.toBeInTheDocument()
  })
})
