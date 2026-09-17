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
      <LabelPicker
        conversationId="conv_1"
        allLabels={allLabels}
        attachedLabels={[allLabels[0]]}
        onAttachedChange={() => {}}
        onAllLabelsChange={() => {}}
      />
    )
    expect(screen.getByText('Confirmed Booking')).toBeInTheDocument()
    // "New Customer" still appears as an option in the "add label" dropdown, just not as a pill.
    expect(screen.queryByLabelText('Hapus label New Customer')).not.toBeInTheDocument()
  })

  it('attaches a label via the dropdown, calling POST and onAttachedChange', async () => {
    const onAttachedChange = vi.fn()
    render(
      <LabelPicker
        conversationId="conv_1"
        allLabels={allLabels}
        attachedLabels={[]}
        onAttachedChange={onAttachedChange}
        onAllLabelsChange={() => {}}
      />
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
        onAllLabelsChange={() => {}}
      />
    )

    fireEvent.click(screen.getByLabelText('Hapus label Confirmed Booking'))

    expect(fetch).toHaveBeenCalledWith('/api/conversations/conv_1/labels', {
      method: 'DELETE',
      body: JSON.stringify({ labelId: 'lbl_1' }),
    })
    await waitFor(() => expect(onAttachedChange).toHaveBeenCalledWith([]))
  })

  it('keeps the dropdown reachable (for "+ Buat label baru") even once every existing label is attached', () => {
    render(
      <LabelPicker
        conversationId="conv_1"
        allLabels={allLabels}
        attachedLabels={allLabels}
        onAttachedChange={() => {}}
        onAllLabelsChange={() => {}}
      />
    )
    // POST /api/labels has no other entry point in the UI -- the dropdown must survive even
    // with zero attachable labels left, or a fresh install could never create its first one.
    const select = screen.getByLabelText('Tambah label')
    expect(select).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '+ Buat label baru...' })).toBeInTheDocument()
  })

  it('does not attach the label when the POST responds non-ok, and shows an error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({ error: 'nope' }) }))
    const onAttachedChange = vi.fn()
    render(
      <LabelPicker
        conversationId="conv_1"
        allLabels={allLabels}
        attachedLabels={[]}
        onAttachedChange={onAttachedChange}
        onAllLabelsChange={() => {}}
      />
    )

    fireEvent.change(screen.getByLabelText('Tambah label'), { target: { value: 'lbl_1' } })

    await waitFor(() => expect(screen.getByText(/Gagal menambahkan label/)).toBeInTheDocument())
    expect(onAttachedChange).not.toHaveBeenCalled()
  })

  it('does not attach the label when the fetch itself rejects (network failure)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    const onAttachedChange = vi.fn()
    render(
      <LabelPicker
        conversationId="conv_1"
        allLabels={allLabels}
        attachedLabels={[]}
        onAttachedChange={onAttachedChange}
        onAllLabelsChange={() => {}}
      />
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
        onAllLabelsChange={() => {}}
      />
    )

    fireEvent.click(screen.getByLabelText('Hapus label Confirmed Booking'))

    await waitFor(() => expect(screen.getByText(/Gagal menghapus label/)).toBeInTheDocument())
    expect(onAttachedChange).not.toHaveBeenCalled()
    // The pill must still be visible — UI stayed in sync with server truth.
    expect(screen.getByText('Confirmed Booking')).toBeInTheDocument()
  })

  describe('membuat label baru', () => {
    function stubCreateThenAttach(created: { id: string; name: string; color: string }) {
      vi.stubGlobal(
        'fetch',
        vi.fn((url: string) => {
          if (url === '/api/labels') return Promise.resolve({ ok: true, json: () => Promise.resolve(created) })
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) })
        })
      )
    }

    it('opens an inline name+color form when "+ Buat label baru..." is picked', () => {
      render(
        <LabelPicker
          conversationId="conv_1"
          allLabels={allLabels}
          attachedLabels={[]}
          onAttachedChange={() => {}}
          onAllLabelsChange={() => {}}
        />
      )

      fireEvent.change(screen.getByLabelText('Tambah label'), { target: { value: '__new__' } })

      expect(screen.getByLabelText('Nama label baru')).toBeInTheDocument()
      expect(screen.getByLabelText('Warna label baru')).toBeInTheDocument()
      expect(screen.queryByLabelText('Tambah label')).not.toBeInTheDocument()
    })

    it('creates the label, attaches it, and reports both to the parent', async () => {
      const created = { id: 'lbl_new', name: 'VIP', color: '#3C6B42' }
      stubCreateThenAttach(created)
      const onAttachedChange = vi.fn()
      const onAllLabelsChange = vi.fn()
      render(
        <LabelPicker
          conversationId="conv_1"
          allLabels={allLabels}
          attachedLabels={[]}
          onAttachedChange={onAttachedChange}
          onAllLabelsChange={onAllLabelsChange}
        />
      )

      fireEvent.change(screen.getByLabelText('Tambah label'), { target: { value: '__new__' } })
      fireEvent.change(screen.getByLabelText('Nama label baru'), { target: { value: 'VIP' } })
      fireEvent.click(screen.getByRole('button', { name: 'Simpan' }))

      await waitFor(() => expect(onAllLabelsChange).toHaveBeenCalledWith([...allLabels, created]))
      expect(fetch).toHaveBeenCalledWith('/api/labels', {
        method: 'POST',
        body: JSON.stringify({ name: 'VIP', color: '#3C6B42' }),
      })
      expect(fetch).toHaveBeenCalledWith('/api/conversations/conv_1/labels', {
        method: 'POST',
        body: JSON.stringify({ labelId: 'lbl_new' }),
      })
      await waitFor(() => expect(onAttachedChange).toHaveBeenCalledWith([created]))
      // Back to the dropdown, ready for the next action.
      expect(screen.getByLabelText('Tambah label')).toBeInTheDocument()
    })

    it('does not submit with a blank name', () => {
      render(
        <LabelPicker
          conversationId="conv_1"
          allLabels={allLabels}
          attachedLabels={[]}
          onAttachedChange={() => {}}
          onAllLabelsChange={() => {}}
        />
      )

      fireEvent.change(screen.getByLabelText('Tambah label'), { target: { value: '__new__' } })

      expect(screen.getByRole('button', { name: 'Simpan' })).toBeDisabled()
    })

    it('cancels back to the dropdown without calling the API', () => {
      render(
        <LabelPicker
          conversationId="conv_1"
          allLabels={allLabels}
          attachedLabels={[]}
          onAttachedChange={() => {}}
          onAllLabelsChange={() => {}}
        />
      )

      fireEvent.change(screen.getByLabelText('Tambah label'), { target: { value: '__new__' } })
      fireEvent.change(screen.getByLabelText('Nama label baru'), { target: { value: 'VIP' } })
      fireEvent.click(screen.getByRole('button', { name: 'Batal' }))

      expect(screen.getByLabelText('Tambah label')).toBeInTheDocument()
      expect(fetch).not.toHaveBeenCalled()
    })

    it('shows an error and stays on the form when creation fails', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({ error: 'nope' }) }))
      const onAllLabelsChange = vi.fn()
      render(
        <LabelPicker
          conversationId="conv_1"
          allLabels={allLabels}
          attachedLabels={[]}
          onAttachedChange={() => {}}
          onAllLabelsChange={onAllLabelsChange}
        />
      )

      fireEvent.change(screen.getByLabelText('Tambah label'), { target: { value: '__new__' } })
      fireEvent.change(screen.getByLabelText('Nama label baru'), { target: { value: 'VIP' } })
      fireEvent.click(screen.getByRole('button', { name: 'Simpan' }))

      await waitFor(() => expect(screen.getByText(/Gagal membuat label/)).toBeInTheDocument())
      expect(onAllLabelsChange).not.toHaveBeenCalled()
      // Stays on the inline form -- the name the operator typed isn't thrown away.
      expect(screen.getByLabelText('Nama label baru')).toHaveValue('VIP')
    })
  })
})
