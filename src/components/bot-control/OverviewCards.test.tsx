import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { OverviewCards } from './OverviewCards'
import type { OverviewCards as OverviewCardsData } from '@/lib/bot-control/overview'

afterEach(cleanup)

function cards(overrides: Partial<OverviewCardsData> = {}): OverviewCardsData {
  return {
    botMode: 'ON',
    outboundDefault: 'UNOFFICIAL',
    officialWebhook: 'ACTIVE',
    unofficialProvider: 'CONFIGURED',
    knowledgeSources: 32,
    botRunsToday: 41,
    handoffToday: 6,
    knowledgeGapsToday: 0,
    failedOutboundJobs: 0,
    ...overrides,
  }
}

describe('OverviewCards', () => {
  it('renders all nine cards of guidebook §18.1', () => {
    render(<OverviewCards cards={cards()} />)

    for (const label of [
      'Mode bot',
      'Outbound default',
      'Webhook Official',
      'Provider Unofficial',
      'Sumber knowledge',
      'Bot run hari ini',
      'Handoff hari ini',
      'Knowledge gap hari ini',
      'Kiriman gagal',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
  })

  it('shows the counts it was given', () => {
    render(<OverviewCards cards={cards({ botRunsToday: 41, handoffToday: 6 })} />)
    expect(screen.getByText('41')).toBeInTheDocument()
    expect(screen.getByText('6')).toBeInTheDocument()
  })

  it('flags an Official outbound default as the policy breach it is', () => {
    // Guidebook §3: Unofficial is the daily send path. Official as the DEFAULT is exactly the
    // kind of drift this page exists to surface, so it must not render as an ordinary value.
    render(<OverviewCards cards={cards({ outboundDefault: 'OFFICIAL' })} />)
    expect(screen.getByText('Kebijakan menetapkan Unofficial sebagai jalur harian.')).toBeInTheDocument()
  })

  it('does not nag when the outbound default follows policy', () => {
    render(<OverviewCards cards={cards({ outboundDefault: 'UNOFFICIAL' })} />)
    expect(screen.queryByText(/Kebijakan menetapkan Unofficial/)).not.toBeInTheDocument()
  })

  it('explains what an inactive Official webhook costs', () => {
    render(<OverviewCards cards={cards({ officialWebhook: 'INACTIVE' })} />)
    expect(screen.getByText('Tidak aktif')).toBeInTheDocument()
    expect(screen.getByText('Pesan masuk dari Meta tidak akan diterima.')).toBeInTheDocument()
  })

  it('explains what an unconfigured Unofficial provider costs', () => {
    render(<OverviewCards cards={cards({ unofficialProvider: 'UNCONFIGURED' })} />)
    expect(screen.getByText('Jalur kirim harian tidak tersedia.')).toBeInTheDocument()
  })

  it('points an empty knowledge index at the fix', () => {
    render(<OverviewCards cards={cards({ knowledgeSources: 0 })} />)
    expect(screen.getByText('Belum ada yang ter-index — jalankan sync di Knowledge Explorer.')).toBeInTheDocument()
  })

  it('warns on a single failed send, because one is a customer left unanswered', () => {
    render(<OverviewCards cards={cards({ failedOutboundJobs: 1 })} />)
    expect(screen.getByText('Pesan ini tidak sampai ke customer.')).toBeInTheDocument()
  })

  it('leaves a busy but healthy day uncoloured', () => {
    // A high handoff count is normal work, not an incident. Colouring every number would make
    // the page decorative and teach operators to stop reading it.
    render(<OverviewCards cards={cards({ handoffToday: 99, failedOutboundJobs: 0 })} />)
    expect(screen.getByText('99')).toBeInTheDocument()
    expect(screen.queryByText('Pesan ini tidak sampai ke customer.')).not.toBeInTheDocument()
  })

  it('says the bot is off in words, not just by an absent badge', () => {
    render(<OverviewCards cards={cards({ botMode: 'OFF' })} />)
    expect(screen.getByText('Off — manual')).toBeInTheDocument()
    expect(screen.getByText('Bot hanya aktif di chat yang dinyalakan manual.')).toBeInTheDocument()
  })
})
