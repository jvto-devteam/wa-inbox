import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { FooterField } from './FooterField'

describe('FooterField', () => {
  it('renders the current value and reports changes, capped at 60 characters', () => {
    const onChange = vi.fn()
    render(<FooterField value="JVTO Tour" onChange={onChange} />)
    const input = screen.getByLabelText('Footer')
    expect(input).toHaveValue('JVTO Tour')
    expect(input).toHaveAttribute('maxLength', '60')

    fireEvent.change(input, { target: { value: 'JVTO Tour Operator' } })
    expect(onChange).toHaveBeenCalledWith('JVTO Tour Operator')
  })
})
