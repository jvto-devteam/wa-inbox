import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { HeaderField } from './HeaderField'

describe('HeaderField', () => {
  it('shows no extra input for NONE', () => {
    render(<HeaderField value={{ type: 'NONE' }} onChange={() => {}} />)
    expect(screen.queryByLabelText('Teks header')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('URL media header')).not.toBeInTheDocument()
  })

  it('shows a text input for TEXT and reports changes', () => {
    const onChange = vi.fn()
    render(<HeaderField value={{ type: 'TEXT', text: '' }} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('Teks header'), { target: { value: 'Selamat Datang' } })
    expect(onChange).toHaveBeenCalledWith({ type: 'TEXT', text: 'Selamat Datang' })
  })

  it('shows a media URL input for IMAGE/VIDEO/DOCUMENT', () => {
    render(<HeaderField value={{ type: 'IMAGE', mediaUrl: 'https://example.com/a.jpg' }} onChange={() => {}} />)
    expect(screen.getByLabelText('URL media header')).toHaveValue('https://example.com/a.jpg')
  })

  it('resets to an empty draft of the newly selected type when the type changes', () => {
    const onChange = vi.fn()
    render(<HeaderField value={{ type: 'TEXT', text: 'Halo' }} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('Tipe header'), { target: { value: 'IMAGE' } })
    expect(onChange).toHaveBeenCalledWith({ type: 'IMAGE', mediaUrl: '' })
  })

  it('exposes a stable EMPTY_HEADER default', async () => {
    const { EMPTY_HEADER } = await import('./HeaderField')
    expect(EMPTY_HEADER).toEqual({ type: 'NONE' })
  })
})
