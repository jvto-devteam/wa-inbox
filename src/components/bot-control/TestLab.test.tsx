import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { TestLab, type SimulationResult } from './TestLab'

function result(overrides: Partial<SimulationResult> = {}): SimulationResult {
  return {
    mode: 'faq',
    reply: 'Rp 1.500.000 per orang.',
    status: 'WOULD_REPLY',
    flowSteps: [{ label: 'Cek booking', detail: 'Tidak ada booking' }],
    knowledgeRefs: { sourceTopic: 'price' },
    verification: null,
    warnings: ['Simulasi dijalankan pada percakapan sandbox.'],
    wouldSendViaChannel: 'UNOFFICIAL',
    decisionRunId: 'run_sim_1',
    latencyMs: 1200,
    ...overrides,
  }
}

function stubSimulate(body: SimulationResult) {
  const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => body }) as Response)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  vi.stubGlobal('location', { href: '/bot-control/test-lab', pathname: '/bot-control/test-lab' })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('TestLab', () => {
  it('will not run with an empty message', () => {
    stubSimulate(result())
    render(<TestLab />)
    expect(screen.getByRole('button', { name: 'Jalankan Simulasi' })).toBeDisabled()
  })

  it('posts the message as a dry run and shows the draft reply', async () => {
    const fetchMock = stubSimulate(result())
    render(<TestLab />)

    fireEvent.change(screen.getByLabelText('Pesan pelanggan'), { target: { value: 'berapa harga ijen?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Jalankan Simulasi' }))

    await waitFor(() => expect(screen.getByText('Rp 1.500.000 per orang.')).toBeInTheDocument())

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/bot-control/simulate')
    expect(JSON.parse(init.body as string)).toMatchObject({ message: 'berapa harga ijen?', dryRun: true })
  })

  it('shows the status, mode and the channel it WOULD have used', async () => {
    stubSimulate(result())
    render(<TestLab />)

    fireEvent.change(screen.getByLabelText('Pesan pelanggan'), { target: { value: 'halo' } })
    fireEvent.click(screen.getByRole('button', { name: 'Jalankan Simulasi' }))

    await waitFor(() => expect(screen.getByText('WOULD_REPLY')).toBeInTheDocument())
    expect(screen.getByText('faq')).toBeInTheDocument()
    expect(screen.getByText('Akan dikirim via UNOFFICIAL')).toBeInTheDocument()
  })

  it('renders flow steps and warnings', async () => {
    stubSimulate(result())
    render(<TestLab />)

    fireEvent.change(screen.getByLabelText('Pesan pelanggan'), { target: { value: 'halo' } })
    fireEvent.click(screen.getByRole('button', { name: 'Jalankan Simulasi' }))

    await waitFor(() => expect(screen.getByText('Cek booking')).toBeInTheDocument())
    expect(screen.getByText('Simulasi dijalankan pada percakapan sandbox.')).toBeInTheDocument()
  })

  it('explains a handoff instead of showing an empty reply box', async () => {
    stubSimulate(result({ mode: 'handoff', status: 'WOULD_HANDOFF', reply: null, knowledgeRefs: null }))
    render(<TestLab />)

    fireEvent.change(screen.getByLabelText('Pesan pelanggan'), { target: { value: 'mau bicara dengan orang' } })
    fireEvent.click(screen.getByRole('button', { name: 'Jalankan Simulasi' }))

    await waitFor(() => expect(screen.getByText(/menyerahkan percakapan ini ke agen/)).toBeInTheDocument())
  })

  it('sends the chosen conversation as context when one is picked', async () => {
    const fetchMock = stubSimulate(result())
    render(<TestLab conversations={[{ id: 'conv_9', contactName: 'Bruno' }]} />)

    fireEvent.change(screen.getByLabelText('Pesan pelanggan'), { target: { value: 'halo' } })
    fireEvent.change(screen.getByLabelText('Pilih konteks'), { target: { value: 'conversation' } })
    fireEvent.change(screen.getByLabelText('Pilih percakapan'), { target: { value: 'conv_9' } })
    fireEvent.click(screen.getByRole('button', { name: 'Jalankan Simulasi' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toMatchObject({ conversationId: 'conv_9', useExistingHistory: true })
  })

  it('hides the conversation picker unless that context is chosen', () => {
    stubSimulate(result())
    render(<TestLab conversations={[{ id: 'conv_9', contactName: 'Bruno' }]} />)
    expect(screen.queryByLabelText('Pilih percakapan')).toBeNull()
  })

  it('links to the recorded run in Decision Logs', async () => {
    stubSimulate(result())
    render(<TestLab />)

    fireEvent.change(screen.getByLabelText('Pesan pelanggan'), { target: { value: 'halo' } })
    fireEvent.click(screen.getByRole('button', { name: 'Jalankan Simulasi' }))

    const link = await screen.findByRole('link', { name: /Lihat di Decision Logs/ })
    expect(link).toHaveAttribute('href', '/bot-control/decisions?run=run_sim_1')
  })

  it('shows a failure as a failure, not as an empty result', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ error: 'Simulasi gagal' }) }) as Response)
    )
    render(<TestLab />)

    fireEvent.change(screen.getByLabelText('Pesan pelanggan'), { target: { value: 'halo' } })
    fireEvent.click(screen.getByRole('button', { name: 'Jalankan Simulasi' }))

    await waitFor(() => expect(screen.getByText('Simulasi gagal')).toBeInTheDocument())
  })
})
