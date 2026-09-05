import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { FlowStepList } from './FlowStepList'
import { WHATSAPP_EXISTING_BOT_FLOW, type ExistingFlowNode } from '@/lib/bot-control/existing-flow-registry'

afterEach(cleanup)

function node(overrides: Partial<ExistingFlowNode> = {}): ExistingFlowNode {
  return {
    id: 'n1',
    order: 1,
    name: 'Langkah Satu',
    type: 'guard',
    description: 'Deskripsi',
    sourceFile: 'src/lib/inbound.ts',
    possibleOutputs: ['lanjut'],
    ...overrides,
  }
}

describe('FlowStepList', () => {
  it('renders every step of the real flow', () => {
    render(<FlowStepList nodes={WHATSAPP_EXISTING_BOT_FLOW.nodes} selectedId={null} onSelect={vi.fn()} />)
    expect(screen.getAllByRole('button')).toHaveLength(28)
  })

  it('renders steps in execution order even when the array is out of order', () => {
    // The order of the steps is the one promise this view makes. Sorting is done by `order`,
    // not trusted from array position, so a node inserted in the wrong place in the registry
    // still renders where it actually runs.
    const nodes = [
      node({ id: 'c', order: 3, name: 'Ketiga' }),
      node({ id: 'a', order: 1, name: 'Pertama' }),
      node({ id: 'b', order: 2, name: 'Kedua' }),
    ]
    render(<FlowStepList nodes={nodes} selectedId={null} onSelect={vi.fn()} />)

    const rendered = screen.getAllByRole('button').map((b) => b.textContent)
    expect(rendered[0]).toContain('Pertama')
    expect(rendered[1]).toContain('Kedua')
    expect(rendered[2]).toContain('Ketiga')
  })

  it('shows each step number and source file so a step can be traced back to code', () => {
    render(<FlowStepList nodes={[node({ order: 7, sourceFile: 'src/lib/bot/orchestrator.ts' })]} selectedId={null} onSelect={vi.fn()} />)
    const button = screen.getByRole('button')
    expect(button).toHaveTextContent('7')
    expect(button).toHaveTextContent('src/lib/bot/orchestrator.ts')
  })

  it('marks only the selected step as pressed', () => {
    const nodes = [node({ id: 'a', order: 1, name: 'Pertama' }), node({ id: 'b', order: 2, name: 'Kedua' })]
    render(<FlowStepList nodes={nodes} selectedId="b" onSelect={vi.fn()} />)

    const pressed = screen.getAllByRole('button').filter((b) => b.getAttribute('aria-pressed') === 'true')
    expect(pressed).toHaveLength(1)
    expect(pressed[0]).toHaveTextContent('Kedua')
  })

  it('reports the clicked step id to its parent', () => {
    const onSelect = vi.fn()
    render(<FlowStepList nodes={[node({ id: 'booking-lookup', name: 'Pencarian booking' })]} selectedId={null} onSelect={onSelect} />)

    fireEvent.click(screen.getByRole('button', { name: /Pencarian booking/ }))
    expect(onSelect).toHaveBeenCalledWith('booking-lookup')
  })

  it('does not crash on an empty flow', () => {
    render(<FlowStepList nodes={[]} selectedId={null} onSelect={vi.fn()} />)
    expect(screen.getByText('Flow ini belum punya langkah.')).toBeInTheDocument()
  })
})
