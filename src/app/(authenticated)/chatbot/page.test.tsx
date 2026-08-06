import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import ChatbotPage from './page'

const settings = {
  workingHoursStart: null,
  workingHoursEnd: null,
  offHoursAutoReply: null,
  botAutoReplyAll: true,
  skipBotForIndonesianNumbers: false,
  catalogSyncedAt: null,
  ollamaModel: 'gemma4:31b-cloud',
}
const gateStatus = { readyForApproval: true, blocking: [] }
const catalogSummary = {
  syncedAt: '2026-07-27T10:00:00.000Z',
  packageCount: 1,
  packages: [{ packageKey: 'ijen-bromo', title: 'Ijen Bromo 3D2N', destinationTokens: ['ijen', 'bromo'], priceIdr: 1500000 }],
}

function mockFetch(overrides: Record<string, unknown> = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/settings' && (!init || init.method === undefined)) return Promise.resolve({ ok: true, json: async () => settings })
      if (url === '/api/settings' && init?.method === 'PATCH') {
        const body = JSON.parse(init.body as string)
        return Promise.resolve({ ok: true, json: async () => ({ ...settings, ...body }) })
      }
      if (url === '/api/bot/gate-status') return Promise.resolve({ ok: true, json: async () => gateStatus })
      if (url === '/api/bot/catalog-summary') return Promise.resolve({ ok: true, json: async () => catalogSummary })
      if (url === '/api/session') return Promise.resolve({ ok: true, json: async () => ({ role: 'ADMIN' }) })
      if (url === '/api/bot/mode' && init?.method === 'POST') {
        return Promise.resolve({ ok: true, json: async () => ({ botAutoReplyAll: false }) })
      }
      if (url === '/api/bot/indonesia-filter' && init?.method === 'POST') {
        return Promise.resolve({ ok: true, json: async () => ({ skipBotForIndonesianNumbers: true }) })
      }
      if (url === '/api/bot/sync-catalog' && init?.method === 'POST') {
        return typeof overrides.sync === 'function' ? (overrides.sync as () => unknown)() : Promise.resolve({ ok: true, json: async () => ({ ok: true }) })
      }
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })
  )
}

beforeEach(() => vi.unstubAllGlobals())
afterEach(() => cleanup())

describe('ChatbotPage', () => {
  it('shows the bot On/Off status and toggles the global mode', async () => {
    mockFetch()
    render(<ChatbotPage />)

    expect(await screen.findByText('Bot: On (Semua Chat)')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Matikan (Off)'))

    await waitFor(() => expect(screen.getByText('Bot: Off (Manual per Chat)')).toBeInTheDocument())
  })

  it('shows the Indonesia-number filter status and toggles it', async () => {
    mockFetch()
    render(<ChatbotPage />)

    expect(await screen.findByText('Nomor Indonesia: Dibalas bot')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Nonaktifkan Bot untuk Nomor Indonesia'))

    await waitFor(() => expect(screen.getByText('Nomor Indonesia: Tidak dibalas bot')).toBeInTheDocument())
  })

  it('shows the deployment gate status and a link to the bot log', async () => {
    mockFetch()
    render(<ChatbotPage />)

    expect(await screen.findByText('Siap')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Lihat log bot' })).toHaveAttribute('href', '/settings/bot-log')
  })

  it('saves working hours and off-hours auto-reply', async () => {
    const fetchMock = vi.fn()
    mockFetch()
    vi.stubGlobal('fetch', vi.mocked(fetch))
    render(<ChatbotPage />)

    await screen.findByLabelText('Mulai')
    fireEvent.change(screen.getByLabelText('Mulai'), { target: { value: '08:00' } })
    fireEvent.change(screen.getByLabelText('Selesai'), { target: { value: '17:00' } })
    fireEvent.change(screen.getByLabelText('Auto-reply di luar jam kerja'), { target: { value: 'Balas di luar jam kerja' } })
    fireEvent.click(screen.getAllByText('Simpan')[0])

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        '/api/settings',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ workingHoursStart: '08:00', workingHoursEnd: '17:00', offHoursAutoReply: 'Balas di luar jam kerja' }),
        })
      )
    )
    void fetchMock
  })

  it('shows the current LLM model and saves changes', async () => {
    mockFetch()
    render(<ChatbotPage />)

    const ollamaInput = await screen.findByLabelText('Model Ollama')
    expect(ollamaInput).toHaveValue('gemma4:31b-cloud')

    fireEvent.change(ollamaInput, { target: { value: 'mistral' } })
    fireEvent.click(screen.getAllByText('Simpan')[1])

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        '/api/settings',
        expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ ollamaModel: 'mistral' }) })
      )
    )
  })

  it('shows the synced catalog packages and last-synced time', async () => {
    mockFetch()
    render(<ChatbotPage />)

    expect(await screen.findByText('Ijen Bromo 3D2N')).toBeInTheDocument()
    expect(screen.getByText('ijen, bromo')).toBeInTheDocument()
    expect(screen.getByText('Rp 1.500.000')).toBeInTheDocument()
  })

  it('re-fetches settings, gate status, and catalog summary after a sync', async () => {
    mockFetch()
    render(<ChatbotPage />)

    fireEvent.click(await screen.findByText('Sinkron Sekarang'))

    await waitFor(() =>
      expect(vi.mocked(fetch).mock.calls.filter(([url]) => url === '/api/bot/catalog-summary')).toHaveLength(2)
    )
  })

  it('hides admin controls for a non-admin role', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url === '/api/settings') return Promise.resolve({ ok: true, json: async () => settings })
        if (url === '/api/bot/gate-status') return Promise.resolve({ ok: true, json: async () => gateStatus })
        if (url === '/api/bot/catalog-summary') return Promise.resolve({ ok: true, json: async () => catalogSummary })
        if (url === '/api/session') return Promise.resolve({ ok: true, json: async () => ({ role: 'AGENT' }) })
        return Promise.resolve({ ok: true, json: async () => ({}) })
      })
    )
    render(<ChatbotPage />)

    await screen.findByText('Bot: On (Semua Chat)')
    expect(screen.queryByText('Matikan (Off)')).not.toBeInTheDocument()
    expect(screen.queryByText('Sinkron Sekarang')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Mulai')).toBeDisabled()
    expect(screen.getByLabelText('Model Ollama')).toBeDisabled()
  })
})
