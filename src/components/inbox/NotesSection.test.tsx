import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { NotesSection } from './NotesSection'

const notes = [
  { id: 'n2', body: 'Follow up minggu depan', authorName: 'Admin', createdAt: '2026-07-26T10:00:00Z' },
  { id: 'n1', body: 'Pelanggan lama', authorName: 'Admin', createdAt: '2026-07-20T10:00:00Z' },
]

describe('NotesSection', () => {
  it('fetches and renders notes newest-first, as returned by the API', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(notes) }))
    render(<NotesSection contactId="contact_1" />)

    await screen.findByText('Follow up minggu depan')
    const rendered = screen.getAllByText(/Follow up minggu depan|Pelanggan lama/)
    expect(rendered[0]).toHaveTextContent('Follow up minggu depan')
    expect(rendered[1]).toHaveTextContent('Pelanggan lama')
    expect(fetch).toHaveBeenCalledWith('/api/contacts/contact_1/notes')
  })

  it('shows an empty state when there are no notes yet', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) }))
    render(<NotesSection contactId="contact_1" />)

    await screen.findByText('Belum ada catatan.')
  })

  it('disables "Tambah Catatan" when the textarea is empty, and does not POST', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) }))
    render(<NotesSection contactId="contact_1" />)

    expect(screen.getByRole('button', { name: 'Tambah Catatan' })).toBeDisabled()
  })

  it('only adds the new note to the list after the server confirms (awaits POST, no optimistic update)', async () => {
    let resolvePost!: (v: { ok: boolean; json: () => Promise<unknown> }) => void
    const postPromise = new Promise<{ ok: boolean; json: () => Promise<unknown> }>((resolve) => {
      resolvePost = resolve
    })
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        if (init?.method === 'POST') return postPromise
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
      })
    )
    render(<NotesSection contactId="contact_1" />)
    await screen.findByText('Belum ada catatan.')

    fireEvent.change(screen.getByLabelText('Catatan baru'), { target: { value: 'Catatan baru dari agen' } })
    fireEvent.click(screen.getByRole('button', { name: 'Tambah Catatan' }))

    // Before the POST resolves, the note must not appear in the notes list yet (it's fine that
    // the text still lives in the uncontrolled textarea's own content — scope to the note <p>).
    expect(screen.queryByText('Catatan baru dari agen', { selector: 'p' })).not.toBeInTheDocument()

    resolvePost({
      ok: true,
      json: () =>
        Promise.resolve({ id: 'n3', body: 'Catatan baru dari agen', authorName: 'Admin', createdAt: '2026-07-26T12:00:00Z' }),
    })

    await screen.findByText('Catatan baru dari agen')
    expect(fetch).toHaveBeenCalledWith('/api/contacts/contact_1/notes', {
      method: 'POST',
      body: JSON.stringify({ body: 'Catatan baru dari agen' }),
    })
    // The textarea clears after a confirmed add.
    expect(screen.getByLabelText('Catatan baru')).toHaveValue('')
  })

  it('shows an error and does not add the note when the POST responds non-ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        if (init?.method === 'POST') return Promise.resolve({ ok: false, json: () => Promise.resolve({ error: 'nope' }) })
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
      })
    )
    render(<NotesSection contactId="contact_1" />)
    await screen.findByText('Belum ada catatan.')

    fireEvent.change(screen.getByLabelText('Catatan baru'), { target: { value: 'Gagal ya' } })
    fireEvent.click(screen.getByRole('button', { name: 'Tambah Catatan' }))

    await waitFor(() => expect(screen.getByText(/Gagal menambahkan catatan/)).toBeInTheDocument())
    expect(screen.queryByText('Gagal ya', { selector: 'p' })).not.toBeInTheDocument()
  })
})
