import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ButtonsField, buttonDraftIsValid } from './ButtonsField'

describe('ButtonsField', () => {
  it('adds a new empty button row, capped at max', () => {
    const onChange = vi.fn()
    render(<ButtonsField buttons={[]} onChange={onChange} max={2} />)
    fireEvent.click(screen.getByText('+ Tombol'))
    expect(onChange).toHaveBeenCalledWith([{ type: 'QUICK_REPLY', text: '', url: '', phoneNumber: '' }])
  })

  it('hides the add button once max is reached', () => {
    render(
      <ButtonsField
        buttons={[
          { type: 'QUICK_REPLY', text: 'A', url: '', phoneNumber: '' },
          { type: 'QUICK_REPLY', text: 'B', url: '', phoneNumber: '' },
        ]}
        onChange={() => {}}
        max={2}
      />
    )
    expect(screen.queryByText('+ Tombol')).not.toBeInTheDocument()
  })

  it('shows the URL field only for a URL button, keyed by labelSuffix', () => {
    render(
      <ButtonsField
        buttons={[{ type: 'URL', text: 'Lihat', url: 'https://x.com', phoneNumber: '' }]}
        onChange={() => {}}
        labelSuffix=" kartu 1"
      />
    )
    expect(screen.getByLabelText('URL tombol 1 kartu 1')).toHaveValue('https://x.com')
    expect(screen.queryByLabelText('Nomor tombol 1 kartu 1')).not.toBeInTheDocument()
  })

  it('removes a button row', () => {
    const onChange = vi.fn()
    render(
      <ButtonsField
        buttons={[
          { type: 'QUICK_REPLY', text: 'A', url: '', phoneNumber: '' },
          { type: 'QUICK_REPLY', text: 'B', url: '', phoneNumber: '' },
        ]}
        onChange={onChange}
      />
    )
    fireEvent.click(screen.getByLabelText('Hapus tombol 1'))
    expect(onChange).toHaveBeenCalledWith([{ type: 'QUICK_REPLY', text: 'B', url: '', phoneNumber: '' }])
  })
})

describe('buttonDraftIsValid', () => {
  it('requires text for every type', () => {
    expect(buttonDraftIsValid({ type: 'QUICK_REPLY', text: '', url: '', phoneNumber: '' })).toBe(false)
  })

  it('requires a url for URL buttons', () => {
    expect(buttonDraftIsValid({ type: 'URL', text: 'Lihat', url: '', phoneNumber: '' })).toBe(false)
    expect(buttonDraftIsValid({ type: 'URL', text: 'Lihat', url: 'https://x.com', phoneNumber: '' })).toBe(true)
  })

  it('requires a phone number for PHONE_NUMBER buttons', () => {
    expect(buttonDraftIsValid({ type: 'PHONE_NUMBER', text: 'Telepon', url: '', phoneNumber: '' })).toBe(false)
    expect(buttonDraftIsValid({ type: 'PHONE_NUMBER', text: 'Telepon', url: '', phoneNumber: '+62' })).toBe(true)
  })
})
