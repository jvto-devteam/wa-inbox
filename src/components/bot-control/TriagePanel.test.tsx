import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { TriagePanel, TriageBadge, type TriageRow } from './TriagePanel'

afterEach(cleanup)

function triage(overrides: Partial<TriageRow> = {}): TriageRow {
  return {
    id: 'tri_1',
    decisionRunId: 'run_1',
    status: 'OPEN',
    issueType: 'BAD_REPLY',
    severity: 'NORMAL',
    assignedTo: null,
    note: null,
    linkedEntityType: null,
    linkedEntityId: null,
    resolvedBy: null,
    resolvedAt: null,
    ...overrides,
  }
}

function renderPanel(props: Partial<Parameters<typeof TriagePanel>[0]> = {}) {
  const onSave = vi.fn()
  render(
    <TriagePanel
      existing={null}
      currentUserId="acc_agent"
      accounts={[{ id: 'acc_agent', name: 'Budi' }, { id: 'acc_lain', name: 'Sari' }]}
      canAssignOthers={false}
      canClose={false}
      saving={false}
      error={null}
      onCancel={vi.fn()}
      onSave={onSave}
      {...props}
    />
  )
  return { onSave }
}

describe('TriagePanel', () => {
  it('says plainly that triage does not change the bot', () => {
    // The whole page is about defects; without this an operator could read filing one as
    // fixing it.
    renderPanel()
    expect(screen.getByText(/tidak mengubah bot/)).toBeInTheDocument()
  })

  it('offers an agent no way to close a triage, and says why', () => {
    // Removing the option beats disabling it: a control that always fails is worse than none.
    renderPanel()
    const select = screen.getByLabelText('Status tindak lanjut')
    expect(select).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'RESOLVED' })).not.toBeInTheDocument()
    expect(screen.getByText(/Hanya admin yang bisa menandai selesai/)).toBeInTheDocument()
  })

  it('offers an admin the closing statuses', () => {
    renderPanel({ canClose: true })
    expect(screen.getByRole('option', { name: 'RESOLVED' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'IGNORED' })).toBeInTheDocument()
  })

  it('gives an agent "ambil sendiri" instead of a roster', () => {
    // Taking work is the one assignment an agent may make; burying it in a dropdown of every
    // account would make it look like a permission they do not have.
    const { onSave } = renderPanel()
    expect(screen.queryByLabelText('Ditugaskan ke')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Ambil sendiri' }))
    fireEvent.click(screen.getByRole('button', { name: 'Simpan tindak lanjut' }))
    expect(onSave.mock.calls[0][0].assignedTo).toBe('acc_agent')
  })

  it('gives an admin the full roster', () => {
    renderPanel({ canAssignOthers: true })
    expect(screen.getByLabelText('Ditugaskan ke')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Sari' })).toBeInTheDocument()
  })

  it('seeds from the existing triage', () => {
    renderPanel({ existing: triage({ severity: 'HIGH', note: 'sudah dicek' }) })
    expect(screen.getByLabelText('Tingkat')).toHaveValue('HIGH')
    expect(screen.getByLabelText('Catatan tindak lanjut')).toHaveValue('sudah dicek')
  })

  it('lets the issue type be left undecided', () => {
    // Filing "something is wrong here" before knowing what kind is the common first act.
    const { onSave } = renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Simpan tindak lanjut' }))
    expect(onSave.mock.calls[0][0].issueType).toBe('')
  })

  it('surfaces a server error rather than failing silently', () => {
    renderPanel({ error: 'Hanya admin yang bisa menugaskan ke orang lain.' })
    expect(screen.getByText(/Hanya admin yang bisa menugaskan/)).toBeInTheDocument()
  })
})

describe('TriageBadge', () => {
  it('renders a dash when nothing has been filed', () => {
    render(<TriageBadge triage={null} />)
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('shows the status and a readable issue label', () => {
    render(<TriageBadge triage={triage({ status: 'ASSIGNED' })} />)
    expect(screen.getByText('ASSIGNED')).toBeInTheDocument()
    expect(screen.getByText('Balasan buruk')).toBeInTheDocument()
  })

  it('shows only the status when the issue type is still undecided', () => {
    render(<TriageBadge triage={triage({ issueType: null })} />)
    expect(screen.getByText('OPEN')).toBeInTheDocument()
  })
})
