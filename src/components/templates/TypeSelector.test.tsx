import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TypeSelector } from './TypeSelector'

describe('TypeSelector', () => {
  it('renders all 5 format options', () => {
    render(<TypeSelector value="TEXT" onChange={() => {}} />)
    expect(screen.getByText('Teks')).toBeInTheDocument()
    expect(screen.getByText('Carousel')).toBeInTheDocument()
    expect(screen.getByText('Penawaran Waktu Terbatas')).toBeInTheDocument()
    expect(screen.getByText('Kode Kupon')).toBeInTheDocument()
    expect(screen.getByText('Autentikasi')).toBeInTheDocument()
  })

  it('marks the current value as checked and reports a click on another option', () => {
    const onChange = vi.fn()
    render(<TypeSelector value="TEXT" onChange={onChange} />)
    expect(screen.getByRole('radio', { name: /Teks/ })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: /Carousel/ })).toHaveAttribute('aria-checked', 'false')

    fireEvent.click(screen.getByText('Carousel'))
    expect(onChange).toHaveBeenCalledWith('CAROUSEL')
  })
})
