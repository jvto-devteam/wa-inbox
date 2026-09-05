import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
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
    ...overrides,
  }
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

  it('renders no toggle at all, not even for editable rules', () => {
    // Phase 1 changes no behaviour. A switch that appears to work but changes nothing is
    // worse than no switch: an operator will believe they turned a rule off.
    render(<RuleRegistryTable rules={listBotRules().map((r) => ({ ...r }))} />)
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
    render(<RuleRegistryTable rules={listBotRules().map((r) => ({ ...r }))} />)
    // header + 10 rules
    expect(screen.getAllByRole('row')).toHaveLength(11)
  })
})
