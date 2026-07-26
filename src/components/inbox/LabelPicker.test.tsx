import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { LabelPicker } from './LabelPicker'

const allLabels = [
  { id: 'lbl_1', name: 'Confirmed Booking', color: '#3C6B42' },
  { id: 'lbl_2', name: 'New Customer', color: '#106877' },
]

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: () => Promise.resolve({ ok: true }) }))
})

describe('LabelPicker', () => {
  it('renders attached labels as pills', () => {
    render(
      <LabelPicker conversationId="conv_1" allLabels={allLabels} attachedLabels={[allLabels[0]]} onAttachedChange={() => {}} />
    )
    expect(screen.getByText('Confirmed Booking')).toBeInTheDocument()
    // "New Customer" still appears as an option in the "add label" dropdown, just not as a pill.
    expect(screen.queryByLabelText('Hapus label New Customer')).not.toBeInTheDocument()
  })

  it('attaches a label via the dropdown, calling POST and onAttachedChange', async () => {
    const onAttachedChange = vi.fn()
    render(
      <LabelPicker conversationId="conv_1" allLabels={allLabels} attachedLabels={[]} onAttachedChange={onAttachedChange} />
    )

    fireEvent.change(screen.getByLabelText('Tambah label'), { target: { value: 'lbl_1' } })

    expect(fetch).toHaveBeenCalledWith('/api/conversations/conv_1/labels', {
      method: 'POST',
      body: JSON.stringify({ labelId: 'lbl_1' }),
    })
    await waitFor(() => expect(onAttachedChange).toHaveBeenCalledWith([allLabels[0]]))
  })

  it('detaches a label when its pill remove button is clicked, calling DELETE and onAttachedChange', async () => {
    const onAttachedChange = vi.fn()
    render(
      <LabelPicker
        conversationId="conv_1"
        allLabels={allLabels}
        attachedLabels={[allLabels[0]]}
        onAttachedChange={onAttachedChange}
      />
    )

    fireEvent.click(screen.getByLabelText('Hapus label Confirmed Booking'))

    expect(fetch).toHaveBeenCalledWith('/api/conversations/conv_1/labels', {
      method: 'DELETE',
      body: JSON.stringify({ labelId: 'lbl_1' }),
    })
    await waitFor(() => expect(onAttachedChange).toHaveBeenCalledWith([]))
  })

  it('hides the add-label dropdown once every label is attached', () => {
    render(
      <LabelPicker conversationId="conv_1" allLabels={allLabels} attachedLabels={allLabels} onAttachedChange={() => {}} />
    )
    expect(screen.queryByLabelText('Tambah label')).not.toBeInTheDocument()
  })
})
