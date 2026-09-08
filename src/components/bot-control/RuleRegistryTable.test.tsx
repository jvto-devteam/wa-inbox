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
    // Null is the correct default: most rules have no switch anywhere at all.
    enabled: null,
    ...overrides,
  }
}

/** The whole real registry, with no live Settings state layered on. */
function allRules(): RuleRow[] {
  return listBotRules().map((r) => rule({ ...r, enabled: r.settingsKey ? true : null }))
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

  it('is read-only — the whole registry renders with no control of any kind', () => {
    // The point of the page. Eight of these ten rules are hardcoded behaviour, and an inert
    // switch that appears to work is worse than no switch: an operator presses it, believes
    // they turned something off, and walks away.
    render(<RuleRegistryTable rules={allRules()} />)
    expect(screen.queryAllByRole('switch')).toHaveLength(0)
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  it('shows a code-enforced rule as always on, and says it has no switch', () => {
    render(<RuleRegistryTable rules={[rule({ enabled: null })]} />)
    expect(screen.getByText('Selalu aktif')).toBeInTheDocument()
    expect(screen.getByText('Tidak ada sakelarnya')).toBeInTheDocument()
    expect(screen.getByText('Kode — perlu deploy')).toBeInTheDocument()
  })

  it('shows enabled and disabled state distinctly for the rules that do have a switch', () => {
    render(
      <RuleRegistryTable
        rules={[
          rule({ key: 'on', settingsKey: 'skipBotForIndonesianNumbers', enabled: true }),
          rule({ key: 'off', settingsKey: 'handoffOnHumanRequest', enabled: false }),
        ]}
      />
    )
    expect(screen.getByText('Aktif')).toBeInTheDocument()
    expect(screen.getByText('Nonaktif')).toBeInTheDocument()
  })

  it('sends a switchable rule to /chatbot, which is the one place that can change it', () => {
    render(<RuleRegistryTable rules={[rule({ settingsKey: 'handoffOnHumanRequest', enabled: true })]} />)
    expect(screen.getByRole('link', { name: 'Chatbot' })).toHaveAttribute('href', '/chatbot')
  })

  it('sends a channel rule to the page that really governs it', () => {
    // "Terkunci" on its own sends an operator hunting for a button that does not exist.
    render(<RuleRegistryTable rules={[rule({ managedIn: { href: '/settings', label: 'Pengaturan' } })]} />)
    expect(screen.getByRole('link', { name: 'Pengaturan' })).toHaveAttribute('href', '/settings')
  })

  it('says so when a switchable rule’s live state could not be read, instead of showing off as fact', () => {
    // The most dangerous silent failure this page can have: an unread column rendered as
    // "Nonaktif" tells an operator the bot stopped doing something it is still doing.
    render(<RuleRegistryTable rules={[rule({ settingsKey: 'handoffOnHumanRequest', enabled: undefined })]} />)
    expect(screen.getByText('Status tidak terbaca')).toBeInTheDocument()
    expect(screen.queryByText('Nonaktif')).not.toBeInTheDocument()
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
})
