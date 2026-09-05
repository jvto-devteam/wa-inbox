import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import { ChannelCapabilityTable } from './ChannelCapabilityTable'

afterEach(cleanup)

function rowFor(label: string) {
  return screen.getByText(label).closest('tr') as HTMLElement
}

describe('ChannelCapabilityTable', () => {
  it('renders one row per capability', () => {
    render(<ChannelCapabilityTable />)
    // header + 12 capabilities
    expect(screen.getAllByRole('row')).toHaveLength(13)
  })

  it('badges an Official-only capability so an operator sees why it cannot go Unofficial', () => {
    render(<ChannelCapabilityTable />)
    expect(within(rowFor('Kirim template')).getByText('Official only')).toBeInTheDocument()
  })

  it('does not badge a capability both channels support', () => {
    render(<ChannelCapabilityTable />)
    expect(within(rowFor('Kirim teks')).queryByText('Official only')).toBeNull()
  })

  it('shows an Unofficial campaign as Terbatas, not as an outright yes or no', () => {
    render(<ChannelCapabilityTable />)
    expect(within(rowFor('Campaign')).getByText('Terbatas')).toBeInTheDocument()
  })
})
