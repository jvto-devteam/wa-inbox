import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { LabelPicker } from './LabelPicker'

const allLabels = [
  { id: 'lbl_1', name: 'Confirmed Booking', color: '#3C6B42' },
  { id: 'lbl_2', name: 'New Customer', color: '#106877' },
]

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ ok: true }) }))
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

  it('does not attach the label when the POST responds non-ok, and shows an error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({ error: 'nope' }) }))
    const onAttachedChange = vi.fn()
    render(
      <LabelPicker conversationId="conv_1" allLabels={allLabels} attachedLabels={[]} onAttachedChange={onAttachedChange} />
    )

    fireEvent.change(screen.getByLabelText('Tambah label'), { target: { value: 'lbl_1' } })

    await waitFor(() => expect(screen.getByText(/Gagal menambahkan label/)).toBeInTheDocument())
    expect(onAttachedChange).not.toHaveBeenCalled()
  })

  it('does not attach the label when the fetch itself rejects (network failure)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    const onAttachedChange = vi.fn()
    render(
      <LabelPicker conversationId="conv_1" allLabels={allLabels} attachedLabels={[]} onAttachedChange={onAttachedChange} />
    )

    fireEvent.change(screen.getByLabelText('Tambah label'), { target: { value: 'lbl_1' } })

    await waitFor(() => expect(screen.getByText(/Gagal menambahkan label/)).toBeInTheDocument())
    expect(onAttachedChange).not.toHaveBeenCalled()
  })

  it('does not detach the label when the DELETE responds non-ok, and shows an error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({ error: 'nope' }) }))
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

    await waitFor(() => expect(screen.getByText(/Gagal menghapus label/)).toBeInTheDocument())
    expect(onAttachedChange).not.toHaveBeenCalled()
    // The pill must still be visible — UI stayed in sync with server truth.
    expect(screen.getByText('Confirmed Booking')).toBeInTheDocument()
  })
})
