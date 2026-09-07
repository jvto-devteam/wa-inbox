import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import { AuditDiff } from './AuditDiff'

afterEach(cleanup)

describe('AuditDiff', () => {
  it('shows each changed field with both sides', () => {
    render(<AuditDiff before={{ enabled: true, severity: 'HIGH' }} after={{ enabled: false, severity: 'LOW' }} />)

    const enabledRow = screen.getByText('enabled').closest('tr')
    expect(enabledRow).not.toBeNull()
    expect(within(enabledRow as HTMLElement).getByText('true')).toBeInTheDocument()
    expect(within(enabledRow as HTMLElement).getByText('false')).toBeInTheDocument()
  })

  it('says so when an action recorded no field-level change', () => {
    // PUBLISH and ROLLBACK record what happened, not a mutated object. An empty box would read
    // as a rendering bug.
    render(<AuditDiff before={null} after={null} />)
    expect(screen.getByText(/Tidak ada perubahan field/)).toBeInTheDocument()
  })

  it('marks an absent side explicitly rather than leaving a blank cell', () => {
    // "This field did not exist before" and "this field was blank" are different facts, and an
    // empty cell cannot tell them apart.
    render(<AuditDiff before={{ note: null }} after={{ note: 'baru' }} />)

    const row = screen.getByText('note').closest('tr')
    expect(within(row as HTMLElement).getByText('—')).toBeInTheDocument()
    expect(within(row as HTMLElement).getByText('baru')).toBeInTheDocument()
  })

  it('renders a nested config as readable JSON, not [object Object]', () => {
    render(<AuditDiff before={{ config: { rate: 20 } }} after={{ config: { rate: 40 } }} />)
    expect(screen.getByText(/"rate": 40/)).toBeInTheDocument()
  })

  it('shows a field that only one side has', () => {
    render(<AuditDiff before={{}} after={{ tambahan: 'ya' }} />)
    expect(screen.getByText('tambahan')).toBeInTheDocument()
  })

  it('orders fields consistently, so two rows of the same change read the same way', () => {
    render(<AuditDiff before={{ zebra: 1, alpha: 1 }} after={{ zebra: 2, alpha: 2 }} />)

    const fields = screen.getAllByRole('row').slice(1).map((row) => row.querySelector('td')?.textContent)
    expect(fields).toEqual(['alpha', 'zebra'])
  })
})
