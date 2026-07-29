import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TemplateGrid } from './TemplateGrid'

const template = {
  id: 't1',
  name: 'sapaan',
  body: 'Halo, ada yang bisa dibantu?',
  format: 'TEXT',
  metaStatus: 'APPROVED' as const,
  category: 'UTILITY',
}

describe('TemplateGrid', () => {
  afterEach(() => vi.restoreAllMocks())

  it('shows an empty state when there are no templates', () => {
    render(<TemplateGrid templates={[]} showStatus onDelete={() => {}} />)
    expect(screen.getByText('Belum ada template.')).toBeInTheDocument()
  })

  it('renders a card per template with its live preview and category', () => {
    render(<TemplateGrid templates={[template]} showStatus onDelete={() => {}} />)
    expect(screen.getByText('sapaan')).toBeInTheDocument()
    expect(screen.getByText('Halo, ada yang bisa dibantu?')).toBeInTheDocument()
    expect(screen.getByText('UTILITY')).toBeInTheDocument()
  })

  it('shows the Meta status badge only when showStatus is true', () => {
    const { rerender } = render(<TemplateGrid templates={[template]} showStatus onDelete={() => {}} />)
    expect(screen.getByText('Disetujui')).toBeInTheDocument()

    rerender(<TemplateGrid templates={[template]} showStatus={false} onDelete={() => {}} />)
    expect(screen.queryByText('Disetujui')).not.toBeInTheDocument()
  })

  it('deletes a template only after the confirm dialog is accepted', () => {
    const onDelete = vi.fn()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<TemplateGrid templates={[template]} showStatus onDelete={onDelete} />)

    fireEvent.click(screen.getByText('Hapus'))

    expect(window.confirm).toHaveBeenCalledWith('Hapus template "sapaan"?')
    expect(onDelete).toHaveBeenCalledWith('t1')
  })

  it('does not delete when the confirm dialog is declined', () => {
    const onDelete = vi.fn()
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<TemplateGrid templates={[template]} showStatus onDelete={onDelete} />)

    fireEvent.click(screen.getByText('Hapus'))

    expect(onDelete).not.toHaveBeenCalled()
  })
})
