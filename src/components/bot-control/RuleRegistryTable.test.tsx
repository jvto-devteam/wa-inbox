import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { RuleRegistryTable, type RuleRow } from './RuleRegistryTable'
import { listBotRules } from '@/lib/bot-control/rule-registry'

afterEach(cleanup)

function rule(overrides: Partial<RuleRow> = {}): RuleRow {
  return {
    key: 'bot.example',
    name: 'Aturan Contoh',
    category: 'Safety',
    description: 'Deskripsi aturan contoh yang cukup panjang untuk dibaca operator.',
    sourceFile: 'src/lib/bot/orchestrator.ts',
    severity: 'NORMAL',
    editable: false,
    enabled: true,
    status: 'PUBLISHED',
    hasDraft: false,
    draftEnabled: null,
    draftConfig: null,
    draftUpdatedAt: null,
    runtimeSource: 'code',
    // Null is the correct default: a rule with no edit surface renders no controls at all.
    editSurface: null,
    ...overrides,
  }
}

/** The whole real registry, widened into rows the way the API returns them. */
function allRules(): RuleRow[] {
  return listBotRules().map((r) => rule({ ...r }))
}

/** A rule whose whole edit surface is its on/off state. */
function editable(overrides: Partial<RuleRow> = {}): RuleRow {
  return rule({ editable: true, editSurface: { canToggleEnabled: true, fields: [] }, ...overrides })
}

describe('RuleRegistryTable', () => {
  it('renders one row per rule with its key, category, severity and source', () => {
    render(<RuleRegistryTable rules={[rule({ key: 'bot.no_invented_price', name: 'Tidak boleh mengarang harga', severity: 'CRITICAL', sourceFile: 'src/lib/bot/reply-verifier.ts', sourceRef: 'verifyReply' })]} />)

    const row = screen.getAllByRole('row')[1]
    expect(within(row).getByText('bot.no_invented_price')).toBeInTheDocument()
    expect(within(row).getByText('CRITICAL')).toBeInTheDocument()
    expect(within(row).getByText('Safety')).toBeInTheDocument()
    expect(within(row).getByText('src/lib/bot/reply-verifier.ts')).toBeInTheDocument()
    expect(within(row).getByText('verifyReply()')).toBeInTheDocument()
  })

  it('distinguishes an editable rule from a locked one', () => {
    render(
      <RuleRegistryTable
        rules={[rule({ key: 'a', name: 'Bisa diubah', editable: true }), rule({ key: 'b', name: 'Tidak bisa diubah', editable: false })]}
      />
    )

    const [, editableRow, lockedRow] = screen.getAllByRole('row')
    expect(within(editableRow).getByText('Ya')).toBeInTheDocument()
    expect(within(lockedRow).getByText('Terkunci')).toBeInTheDocument()
  })

  it('stays entirely read-only when no action handler is supplied', () => {
    // The default is still a table an AGENT can look at. Controls are opt-in, and even then
    // only for rules the server says have an edit surface.
    render(<RuleRegistryTable rules={allRules()} />)
    expect(screen.queryAllByRole('switch')).toHaveLength(0)
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  it('shows enabled and disabled state distinctly', () => {
    render(<RuleRegistryTable rules={[rule({ key: 'on', enabled: true }), rule({ key: 'off', enabled: false })]} />)
    expect(screen.getByText('Aktif')).toBeInTheDocument()
    expect(screen.getByText('Nonaktif')).toBeInTheDocument()
  })

  it('says so when a rule’s live state could not be read, instead of showing the default as fact', () => {
    render(<RuleRegistryTable rules={[rule({ enabled: false, liveStateUnavailable: true })]} />)
    expect(screen.getByText('Status live tidak terbaca')).toBeInTheDocument()
  })

  it('renders an empty filter result as an empty result, not a blank table', () => {
    render(<RuleRegistryTable rules={[]} />)
    expect(screen.getByText('Tidak ada aturan yang cocok dengan filter.')).toBeInTheDocument()
  })

  it('renders the whole real registry without crashing', () => {
    render(<RuleRegistryTable rules={allRules()} />)
    // header + 10 rules
    expect(screen.getAllByRole('row')).toHaveLength(11)
  })

  it('renders no action controls at all without a handler', () => {
    render(<RuleRegistryTable rules={[editable()]} canEdit canApprove />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('renders no controls for a locked rule, even for an admin', () => {
    // An inert switch that appears to work is worse than no switch: an operator will believe
    // they turned something off.
    render(<RuleRegistryTable rules={[rule()]} canEdit canApprove onAction={vi.fn()} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('offers a draft button for an editable rule and reports the action', () => {
    const onAction = vi.fn()
    render(<RuleRegistryTable rules={[editable()]} canEdit onAction={onAction} />)

    fireEvent.click(screen.getByRole('button', { name: 'Buat draft' }))
    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ key: 'bot.example' }), 'edit')
  })

  it('only offers "kirim ke review" once a draft exists', () => {
    const onAction = vi.fn()
    const { rerender } = render(<RuleRegistryTable rules={[editable()]} canEdit onAction={onAction} />)
    expect(screen.queryByRole('button', { name: 'Kirim ke review' })).not.toBeInTheDocument()

    rerender(
      <RuleRegistryTable rules={[editable({ status: 'DRAFT', hasDraft: true })]} canEdit onAction={onAction} />
    )
    expect(screen.getByRole('button', { name: 'Kirim ke review' })).toBeInTheDocument()
  })

  it('only offers approve on a rule that is actually in review', () => {
    // A button that always 409s teaches an operator to stop trusting the page.
    const onAction = vi.fn()
    const { rerender } = render(
      <RuleRegistryTable rules={[editable({ status: 'DRAFT', hasDraft: true })]} canApprove onAction={onAction} />
    )
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()

    rerender(
      <RuleRegistryTable rules={[editable({ status: 'REVIEW', hasDraft: true })]} canApprove onAction={onAction} />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    expect(onAction).toHaveBeenCalledWith(expect.anything(), 'approve')
  })

  it('never offers approve or reject to someone who may only edit', () => {
    render(
      <RuleRegistryTable rules={[editable({ status: 'REVIEW', hasDraft: true })]} canEdit onAction={vi.fn()} />
    )
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument()
  })

  it('shows a pending draft separately from what the bot is doing now', () => {
    // Merging the two would make a draft read as though it were already in force.
    render(<RuleRegistryTable rules={[editable({ status: 'REVIEW', hasDraft: true, enabled: true })]} />)
    expect(screen.getByText('Aktif')).toBeInTheDocument()
    expect(screen.getByText('Draft: REVIEW')).toBeInTheDocument()
  })

  it('says an approved rule is waiting on a release, not on the operator', () => {
    render(<RuleRegistryTable rules={[editable({ status: 'APPROVED', hasDraft: true })]} canEdit onAction={vi.fn()} />)
    expect(screen.getByText(/Menunggu publish lewat Releases/)).toBeInTheDocument()
  })

  it('marks a CRITICAL rule that may be reconfigured but not switched off', () => {
    render(
      <RuleRegistryTable
        rules={[editable({ severity: 'CRITICAL', editSurface: { canToggleEnabled: false, fields: ['liveDefaultChannel'] } })]}
      />
    )
    expect(screen.getByText('Hanya nilainya')).toBeInTheDocument()
  })
})