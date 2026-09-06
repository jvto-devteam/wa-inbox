import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { LatestDecisionsWidget, RecentFailedSendsWidget, TopUnansweredTopicsWidget } from './OverviewWidgets'
import type { OverviewDecision, OverviewFailedSend } from '@/lib/bot-control/overview'

afterEach(cleanup)

function decision(overrides: Partial<OverviewDecision> = {}): OverviewDecision {
  return {
    id: 'run_1',
    conversationId: 'conv_1',
    contactName: 'Bruno Figarola',
    status: 'HANDOFF',
    inboundPreview: 'saya mau bicara dengan orang',
    startedAt: '2026-09-06T01:00:00.000Z',
    ...overrides,
  }
}

function failedSend(overrides: Partial<OverviewFailedSend> = {}): OverviewFailedSend {
  return {
    id: 'job_1',
    conversationId: 'conv_2',
    contactName: 'Sanne de Vries',
    channel: 'UNOFFICIAL',
    provider: 'COEXIST',
    attempts: 4,
    maxAttempts: 4,
    lastError: 'connect ECONNREFUSED 127.0.0.1:4000',
    createdAt: '2026-09-06T00:30:00.000Z',
    ...overrides,
  }
}

describe('LatestDecisionsWidget', () => {
  it('links each decision to its own trace', () => {
    render(<LatestDecisionsWidget decisions={[decision()]} />)
    expect(screen.getByRole('link')).toHaveAttribute('href', '/bot-control/decisions?run=run_1')
  })

  it('shows the status and what the customer actually said', () => {
    render(<LatestDecisionsWidget decisions={[decision()]} />)
    expect(screen.getByText('HANDOFF')).toBeInTheDocument()
    expect(screen.getByText('saya mau bicara dengan orang')).toBeInTheDocument()
  })

  it('names a deleted contact instead of rendering a blank row', () => {
    // The audit row outlives the conversation on purpose; an empty cell would read as a bug.
    render(<LatestDecisionsWidget decisions={[decision({ contactName: null })]} />)
    expect(screen.getByText('Kontak terhapus')).toBeInTheDocument()
  })

  it('says so when there is nothing yet', () => {
    render(<LatestDecisionsWidget decisions={[]} />)
    expect(screen.getByText('Belum ada keputusan bot yang tercatat.')).toBeInTheDocument()
  })
})

describe('TopUnansweredTopicsWidget', () => {
  it('lists topics with how often they came up', () => {
    render(
      <TopUnansweredTopicsWidget
        topics={[
          { topic: 'asuransi', count: 9 },
          { topic: 'transport_bandara', count: 4 },
        ]}
      />
    )
    expect(screen.getByText('asuransi')).toBeInTheDocument()
    expect(screen.getByText('9×')).toBeInTheDocument()
    expect(screen.getByText('transport_bandara')).toBeInTheDocument()
  })

  it('states the window, so the numbers are not read as all-time', () => {
    render(<TopUnansweredTopicsWidget topics={[]} />)
    expect(screen.getByText('7 hari terakhir.')).toBeInTheDocument()
  })

  it('distinguishes "no gaps" from "no data"', () => {
    render(<TopUnansweredTopicsWidget topics={[]} />)
    expect(screen.getByText('Tidak ada knowledge gap pada rentang ini.')).toBeInTheDocument()
  })
})

describe('RecentFailedSendsWidget', () => {
  it('links to the conversation, where the retry button lives', () => {
    render(<RecentFailedSendsWidget sends={[failedSend()]} />)
    expect(screen.getByRole('link')).toHaveAttribute('href', '/inbox?conversation=conv_2')
  })

  it('shows the error and how many attempts were burned', () => {
    render(<RecentFailedSendsWidget sends={[failedSend()]} />)
    expect(screen.getByText('connect ECONNREFUSED 127.0.0.1:4000')).toBeInTheDocument()
    expect(screen.getByText('4/4 percobaan')).toBeInTheDocument()
  })

  it('still renders a job whose failure carried no message', () => {
    render(<RecentFailedSendsWidget sends={[failedSend({ lastError: null })]} />)
    expect(screen.getByText('Tidak ada pesan error yang tercatat.')).toBeInTheDocument()
  })

  it('says so when nothing has failed', () => {
    render(<RecentFailedSendsWidget sends={[]} />)
    expect(screen.getByText('Tidak ada kiriman yang gagal.')).toBeInTheDocument()
  })
})
