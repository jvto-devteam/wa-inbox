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

  // Task 17 (Ruling R54): "kenapa fakta ini tidak ikut?" answered directly in the popover --
  // both the facts actually sent (with their source) and the ones the topic gate turned away.
  describe('knowledge (fakta yang dipakai/ditolak)', () => {
    it('renders each used fact with its source, and each rejected fact with its reason', () => {
      render(
        <BotTracePopover
          trace={{
            mode: 'faq',
            draft: 'Deposit dibayar 20%.',
            sourceTopic: 'payment',
            knowledge: {
              catalogLines: ['Every package includes private transport.'],
              managedLines: [{ line: 'Berapa deposit? — 20% dari total.', source: 'Kebijakan Pembayaran (v3)' }],
              rejected: [
                { sourceKey: 'managed/route', itemQuestion: 'Berapa deposit di Malang?', reason: 'topik [payment] tidak memuat route_endpoint' },
              ],
              gateBypassed: false,
            },
          }}
          onClose={() => {}}
        />
      )

      expect(screen.getByText('Fakta yang dipakai')).toBeInTheDocument()
      expect(screen.getByText(/Every package includes private transport\./)).toBeInTheDocument()
      expect(screen.getByText(/Berapa deposit\? — 20% dari total\./)).toBeInTheDocument()
      expect(screen.getByText(/Kebijakan Pembayaran \(v3\)/)).toBeInTheDocument()

      expect(screen.getByText('Fakta yang ditolak')).toBeInTheDocument()
      expect(screen.getByText(/Berapa deposit di Malang\?/)).toBeInTheDocument()
      expect(screen.getByText(/topik \[payment\] tidak memuat route_endpoint/)).toBeInTheDocument()
    })

    it('renders neither list when knowledge is absent', () => {
      render(<BotTracePopover trace={{ mode: 'handoff', reason: 'Kata kunci eskalasi terdeteksi' }} onClose={() => {}} />)
      expect(screen.queryByText('Fakta yang dipakai')).not.toBeInTheDocument()
      expect(screen.queryByText('Fakta yang ditolak')).not.toBeInTheDocument()
    })

    it('renders neither list for a booking_context decision, which never carries knowledge (Ruling R77)', () => {
      render(<BotTracePopover trace={{ mode: 'booking_context', reply: 'Booking Anda berangkat 5 Agustus.' }} onClose={() => {}} />)
      expect(screen.queryByText('Fakta yang dipakai')).not.toBeInTheDocument()
      expect(screen.queryByText('Fakta yang ditolak')).not.toBeInTheDocument()
    })

    it('renders only "Fakta yang dipakai" when nothing was rejected', () => {
      render(
        <BotTracePopover
          trace={{
            mode: 'faq',
            draft: 'x',
            sourceTopic: 'payment',
            knowledge: { catalogLines: ['Satu fakta katalog.'], managedLines: [], rejected: [], gateBypassed: false },
          }}
          onClose={() => {}}
        />
      )
      expect(screen.getByText('Fakta yang dipakai')).toBeInTheDocument()
      expect(screen.queryByText('Fakta yang ditolak')).not.toBeInTheDocument()
    })

    it('renders only "Fakta yang ditolak" when nothing was used', () => {
      render(
        <BotTracePopover
          trace={{
            mode: 'clarify',
            reply: 'x',
            knowledge: {
              catalogLines: [],
              managedLines: [],
              rejected: [{ sourceKey: 'managed/route', itemQuestion: 'Q?', reason: 'topik [payment] tidak memuat route_endpoint' }],
              gateBypassed: false,
            },
          }}
          onClose={() => {}}
        />
      )
      expect(screen.queryByText('Fakta yang dipakai')).not.toBeInTheDocument()
      expect(screen.getByText('Fakta yang ditolak')).toBeInTheDocument()
    })

    // Ruling R83: `rejected` di runtime-integration.ts sekarang dibatasi MAX_REJECTED_RECORDED
    // (20) -- popover harus tetap memberi tahu operator ada lebih banyak, bukan diam-diam
    // menunjukkan daftar yang terlihat lengkap padahal terpotong.
    it('menampilkan "+N lainnya" saat rejectedOmitted > 0', () => {
      render(
        <BotTracePopover
          trace={{
            mode: 'clarify',
            reply: 'x',
            knowledge: {
              catalogLines: [],
              managedLines: [],
              rejected: [{ sourceKey: 'managed/route', itemQuestion: 'Q?', reason: 'topik [payment] tidak memuat route_endpoint' }],
              rejectedOmitted: 130,
              gateBypassed: false,
            },
          }}
          onClose={() => {}}
        />
      )
      expect(screen.getByText('Fakta yang ditolak')).toBeInTheDocument()
      expect(screen.getByText('+130 lainnya')).toBeInTheDocument()
    })

    it('tidak menampilkan "+N lainnya" saat rejectedOmitted 0 atau absen', () => {
      render(
        <BotTracePopover
          trace={{
            mode: 'clarify',
            reply: 'x',
            knowledge: {
              catalogLines: [],
              managedLines: [],
              rejected: [{ sourceKey: 'managed/route', itemQuestion: 'Q?', reason: 'topik [payment] tidak memuat route_endpoint' }],
              rejectedOmitted: 0,
              gateBypassed: false,
            },
          }}
          onClose={() => {}}
        />
      )
      expect(screen.queryByText(/lainnya/)).not.toBeInTheDocument()
    })

    // Ruling R91: the test above only ever built a fixture with `rejectedOmitted: 0` -- it
    // never actually left the key OUT, so the "atau absen" half of its own name was unproven.
    // `rejectedOmitted` is optional on `DecisionKnowledge` (Ruling R83) precisely so an
    // older-shaped `knowledge` object -- one that predates this field entirely -- still renders
    // correctly; this is the fixture that is actually missing the key, not merely zero.
    it('tidak menampilkan "+N lainnya" saat kunci rejectedOmitted benar-benar absen (bukan hanya 0)', () => {
      render(
        <BotTracePopover
          trace={{
            mode: 'clarify',
            reply: 'x',
            knowledge: {
              catalogLines: [],
              managedLines: [],
              rejected: [{ sourceKey: 'managed/route', itemQuestion: 'Q?', reason: 'topik [payment] tidak memuat route_endpoint' }],
              // rejectedOmitted deliberately omitted -- see comment above.
              gateBypassed: false,
            },
          }}
          onClose={() => {}}
        />
      )
      expect(screen.getByText('Fakta yang ditolak')).toBeInTheDocument()
      expect(screen.queryByText(/lainnya/)).not.toBeInTheDocument()
    })
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
