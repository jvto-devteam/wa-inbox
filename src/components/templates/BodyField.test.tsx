import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BodyField } from './BodyField'

describe('BodyField', () => {
  it('renders the current value and placeholder', () => {
    render(<BodyField value="Halo" onChange={() => {}} placeholder="Isi pesan..." />)
    expect(screen.getByLabelText('Isi pesan')).toHaveValue('Halo')
    expect(screen.getByPlaceholderText('Isi pesan...')).toBeInTheDocument()
  })

  it('inserts {{1}} at the cursor position, not appended to the end', () => {
    const onChange = vi.fn()
    render(<BodyField value="Halo , sampai jumpa" onChange={onChange} />)
    const textarea = screen.getByLabelText('Isi pesan') as HTMLTextAreaElement
    textarea.selectionStart = 5
    textarea.selectionEnd = 5

    fireEvent.click(screen.getByText('+ Variabel'))

    expect(onChange).toHaveBeenCalledWith('Halo {{1}}, sampai jumpa')
  })

  it('numbers each new variable sequentially based on how many are already in the body', () => {
    const onChange = vi.fn()
    render(<BodyField value="Halo {{1}}, sisa " onChange={onChange} />)
    const textarea = screen.getByLabelText('Isi pesan') as HTMLTextAreaElement
    textarea.selectionStart = textarea.value.length
    textarea.selectionEnd = textarea.value.length

    fireEvent.click(screen.getByText('+ Variabel'))

    expect(onChange).toHaveBeenCalledWith('Halo {{1}}, sisa {{2}}')
  })

  it('shows a character counter against the maxLength', () => {
    render(<BodyField value="Halo" onChange={() => {}} maxLength={1024} />)
    expect(screen.getByText('4/1024')).toBeInTheDocument()
  })
})
