import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BotTracePopover } from './BotTracePopover'

describe('BotTracePopover', () => {
  it('shows the FAQ mode and source topic', () => {
    render(<BotTracePopover trace={{ mode: 'faq', draft: 'Info paket...', sourceTopic: 'inclusions' }} />)
    expect(screen.getByText(/faq/i)).toBeInTheDocument()
    expect(screen.getByText(/inclusions/i)).toBeInTheDocument()
  })

  it('shows the handoff reason', () => {
    render(<BotTracePopover trace={{ mode: 'handoff', reason: 'Kata kunci eskalasi terdeteksi' }} />)
    expect(screen.getByText('Kata kunci eskalasi terdeteksi')).toBeInTheDocument()
  })

  it('shows the funnel next state', () => {
    render(<BotTracePopover trace={{ mode: 'funnel', reply: 'Boleh info tanggal?', nextState: 'ASK_DATE' }} />)
    expect(screen.getByText(/funnel/i)).toBeInTheDocument()
    expect(screen.getByText(/ASK_DATE/)).toBeInTheDocument()
  })

  it('shows the booking_context source', () => {
    render(<BotTracePopover trace={{ mode: 'booking_context', reply: 'Booking Anda berangkat 5 Agustus.' }} />)
    expect(screen.getByText(/booking_context/i)).toBeInTheDocument()
    expect(screen.getByText(/booking api/i)).toBeInTheDocument()
  })
})
