import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import { BotTracePopover } from './BotTracePopover'

describe('BotTracePopover', () => {
  it('shows the FAQ mode and source topic', () => {
    render(<BotTracePopover trace={{ mode: 'faq', draft: 'Info paket...', sourceTopic: 'inclusions' }} onClose={() => {}} />)
    expect(screen.getByText(/faq/i)).toBeInTheDocument()
    expect(screen.getByText(/inclusions/i)).toBeInTheDocument()
  })

  it('shows the handoff reason', () => {
    render(<BotTracePopover trace={{ mode: 'handoff', reason: 'Kata kunci eskalasi terdeteksi' }} onClose={() => {}} />)
    expect(screen.getByText('Kata kunci eskalasi terdeteksi')).toBeInTheDocument()
  })

  it('shows the clarify mode explanation', () => {
    render(<BotTracePopover trace={{ mode: 'clarify', reply: 'Anda tertarik jalan-jalan ke mana?' }} onClose={() => {}} />)
    expect(screen.getByText(/clarify/i)).toBeInTheDocument()
    expect(screen.getByText(/menanyakan/i)).toBeInTheDocument()
  })

  it('shows the booking_context source', () => {
    render(<BotTracePopover trace={{ mode: 'booking_context', reply: 'Booking Anda berangkat 5 Agustus.' }} onClose={() => {}} />)
    expect(screen.getByText(/booking_context/i)).toBeInTheDocument()
    expect(screen.getByText(/booking api/i)).toBeInTheDocument()
  })

  it('renders the step-by-step reasoning trace, in order, when present', () => {
    render(
      <BotTracePopover
        trace={{
          mode: 'handoff',
          reason: 'Kata kunci eskalasi terdeteksi',
          steps: [
            { label: 'Pesan diterima', detail: 'Memeriksa kata kunci eskalasi.' },
            { label: 'Eskalasi terdeteksi', detail: 'Diserahkan ke agen.' },
          ],
        }}
        onClose={() => {}}
      />
    )

    const labels = screen.getAllByText(/Pesan diterima|Eskalasi terdeteksi/).map((el) => el.textContent)
    expect(labels).toEqual(['Pesan diterima', 'Eskalasi terdeteksi'])
    expect(screen.getByText('Memeriksa kata kunci eskalasi.')).toBeInTheDocument()
    expect(screen.getByText('Diserahkan ke agen.')).toBeInTheDocument()
  })

  it('falls back to just the terse summary when steps is absent (a botTrace row stored before the trace feature existed)', () => {
    render(<BotTracePopover trace={{ mode: 'handoff', reason: 'Kata kunci eskalasi terdeteksi' }} onClose={() => {}} />)
    // No numbered step list rendered -- only the one-line summary above.
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })

  it('renders nothing extra when steps is an empty array', () => {
    render(<BotTracePopover trace={{ mode: 'handoff', reason: 'x', steps: [] }} onClose={() => {}} />)
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })
})

describe('BotTracePopover run lookup (Phase 3)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    cleanup()
  })

  it('says so plainly when a bot message has no stored trace', () => {
    render(<BotTracePopover trace={null} onClose={() => {}} />)
    expect(screen.getByText('Trace tidak tersedia untuk pesan ini')).toBeInTheDocument()
  })

  it('does not query for a decision run when there is no message id', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    render(<BotTracePopover trace={null} onClose={() => {}} />)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('offers a link to the full decision detail once a run is found', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ items: [{ id: 'run_7' }] }) }) as Response)
    )

    render(<BotTracePopover trace={{ mode: 'faq', draft: 'x', sourceTopic: 'price' }} messageId="msg_1" onClose={() => {}} />)

    const link = await screen.findByRole('link', { name: /Lihat detail keputusan lengkap/ })
    expect(link).toHaveAttribute('href', '/bot-control/decisions?run=run_7')
  })

  it('shows no link when the message has no recorded run', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ items: [] }) }) as Response)
    )

    render(<BotTracePopover trace={{ mode: 'faq', draft: 'x', sourceTopic: 'price' }} messageId="msg_1" onClose={() => {}} />)

    await waitFor(() => expect(screen.getByText('Sumber topik: price')).toBeInTheDocument())
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('keeps rendering the trace when the run lookup fails', async () => {
    // The link is an enhancement on top of botTrace, which is already on screen. A failed
    // lookup must not replace a trace the agent can read with an error they did not ask for.
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ error: 'boom' }) }) as Response))

    render(<BotTracePopover trace={{ mode: 'handoff', reason: 'Minta manusia' }} messageId="msg_1" onClose={() => {}} />)

    await waitFor(() => expect(screen.getByText('Minta manusia')).toBeInTheDocument())
    expect(screen.queryByRole('link')).toBeNull()
  })
})
