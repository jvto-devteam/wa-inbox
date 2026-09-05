import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { DecisionTracePanel, type DecisionRunDetail } from './DecisionTracePanel'

afterEach(cleanup)

function run(overrides: Partial<DecisionRunDetail> = {}): DecisionRunDetail {
  return {
    id: 'run_1',
    conversationId: 'conv_1',
    messageId: 'msg_1',
    contactName: 'Bruno Figarola',
    contactPhone: '6281234567890',
    mode: 'faq',
    status: 'REPLIED',
    inboundText: 'berapa harga ijen?',
    replyText: 'Rp 1.500.000 per orang.',
    flowKey: 'whatsapp-existing-bot-v1',
    flowVersion: 1,
    latencyMs: 2500,
    trace: { mode: 'faq', steps: [{ label: 'Cek booking', detail: 'Tidak ada booking' }] },
    knowledgeRefs: { sourceTopic: 'price' },
    verification: null,
    error: null,
    startedAt: '2026-09-05T03:00:00.000Z',
    finishedAt: '2026-09-05T03:00:02.500Z',
    ...overrides,
  }
}

describe('DecisionTracePanel', () => {
  it('renders the decision, the inbound message and the reply', () => {
    render(<DecisionTracePanel run={run()} />)
    expect(screen.getByText('REPLIED')).toBeInTheDocument()
    expect(screen.getByText('faq')).toBeInTheDocument()
    expect(screen.getByText('2500 ms')).toBeInTheDocument()
    expect(screen.getByText('berapa harga ijen?')).toBeInTheDocument()
    expect(screen.getByText('Rp 1.500.000 per orang.')).toBeInTheDocument()
  })

  it('renders the flow steps as readable text, not raw JSON', () => {
    render(<DecisionTracePanel run={run()} />)
    expect(screen.getByText('Cek booking')).toBeInTheDocument()
    expect(screen.getByText('Tidak ada booking')).toBeInTheDocument()
  })

  it('keeps the raw trace behind a collapsible for developers', () => {
    render(<DecisionTracePanel run={run()} />)
    expect(screen.queryByText(/"mode": "faq"/)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Tampilkan trace mentah' }))
    expect(screen.getByText(/"mode": "faq"/)).toBeInTheDocument()
  })

  it('shows the handoff reason from the trace', () => {
    render(<DecisionTracePanel run={run({ mode: 'handoff', status: 'HANDOFF', trace: { mode: 'handoff', reason: 'Minta manusia' } })} />)
    expect(screen.getByText('Minta manusia')).toBeInTheDocument()
  })

  it('shows an error as an error, never folded into the normal reason line', () => {
    render(<DecisionTracePanel run={run({ status: 'FAILED', error: 'Ollama timeout', trace: null })} />)
    const error = screen.getByText('Ollama timeout')
    expect(error).toBeInTheDocument()
    expect(error.className).toContain('text-destructive')
  })

  it('says the trace is unavailable rather than rendering an empty panel', () => {
    render(<DecisionTracePanel run={null} />)
    expect(screen.getByText('Trace tidak tersedia untuk pesan ini')).toBeInTheDocument()
  })

  it('does not crash on a run with a null trace and no steps', () => {
    render(<DecisionTracePanel run={run({ trace: null, knowledgeRefs: null, replyText: null })} />)
    expect(screen.getByText('REPLIED')).toBeInTheDocument()
  })

  it('ignores a malformed steps array instead of throwing', () => {
    // The trace column is free-form Json; a row written by an older or buggier producer must
    // not take the panel down.
    render(<DecisionTracePanel run={run({ trace: { steps: ['bukan objek', { detail: 'tanpa label' }] } })} />)
    expect(screen.getByText('REPLIED')).toBeInTheDocument()
  })

  it('hides the verification section when there is nothing to verify', () => {
    render(<DecisionTracePanel run={run({ verification: null })} />)
    expect(screen.queryByText('Verifikasi harga/URL')).toBeNull()
  })
})
