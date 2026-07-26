import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { RemindersSection } from './RemindersSection'

const reminders = [
  { id: 'r1', dueAt: '2026-08-01T00:00:00Z', note: 'Follow up pembayaran DP', done: false },
  { id: 'r2', dueAt: '2026-08-05T00:00:00Z', note: 'Kirim itinerary', done: true },
]

describe('RemindersSection', () => {
  it('fetches and renders reminders, as returned by the API', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(reminders) }))
    render(<RemindersSection contactId="contact_1" />)

    await screen.findByText('Follow up pembayaran DP')
    expect(screen.getByText('Kirim itinerary')).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledWith('/api/contacts/contact_1/reminders')
  })

  it('shows an empty state when there are no reminders yet', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) }))
    render(<RemindersSection contactId="contact_1" />)

    await screen.findByText('Belum ada reminder.')
  })

  it('disables "Tambah Reminder" until both a date and a note are provided', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) }))
    render(<RemindersSection contactId="contact_1" />)
    await screen.findByText('Belum ada reminder.')

    const button = screen.getByRole('button', { name: 'Tambah Reminder' })
    expect(button).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Catatan reminder'), { target: { value: 'Follow up' } })
    expect(button).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Tanggal jatuh tempo'), { target: { value: '2026-08-10' } })
    expect(button).not.toBeDisabled()
  })

  it('POSTs an ISO dueAt built from the native date input, and only adds the reminder after the server confirms', async () => {
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
    render(<RemindersSection contactId="contact_1" />)
    await screen.findByText('Belum ada reminder.')

    fireEvent.change(screen.getByLabelText('Tanggal jatuh tempo'), { target: { value: '2026-08-10' } })
    fireEvent.change(screen.getByLabelText('Catatan reminder'), { target: { value: 'Follow up pembayaran' } })
    fireEvent.click(screen.getByRole('button', { name: 'Tambah Reminder' }))

    // Before the POST resolves, the reminder must not appear in the list yet — no optimistic update.
    expect(screen.queryByText('Follow up pembayaran')).not.toBeInTheDocument()

    resolvePost({
      ok: true,
      json: () => Promise.resolve({ id: 'r3', dueAt: '2026-08-10T00:00:00.000Z', note: 'Follow up pembayaran', done: false }),
    })

    await screen.findByText('Follow up pembayaran')

    const [, body] = (fetch as ReturnType<typeof vi.fn>).mock.calls.find(([, init]) => init?.method === 'POST')!
    const parsedBody = JSON.parse(body.body as string)
    expect(parsedBody.note).toBe('Follow up pembayaran')
    // The native <input type="date"> value must be converted into a valid, parseable ISO string.
    expect(new Date(parsedBody.dueAt).toISOString()).toBe(parsedBody.dueAt)
    expect(Number.isNaN(new Date(parsedBody.dueAt).getTime())).toBe(false)
  })

  it('shows an error and does not add the reminder when the POST responds non-ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        if (init?.method === 'POST') return Promise.resolve({ ok: false, json: () => Promise.resolve({ error: 'nope' }) })
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
      })
    )
    render(<RemindersSection contactId="contact_1" />)
    await screen.findByText('Belum ada reminder.')

    fireEvent.change(screen.getByLabelText('Tanggal jatuh tempo'), { target: { value: '2026-08-10' } })
    fireEvent.change(screen.getByLabelText('Catatan reminder'), { target: { value: 'Gagal ya' } })
    fireEvent.click(screen.getByRole('button', { name: 'Tambah Reminder' }))

    await waitFor(() => expect(screen.getByText(/Gagal menambahkan reminder/)).toBeInTheDocument())
    expect(screen.queryByText('Gagal ya')).not.toBeInTheDocument()
  })

  it('checking a reminder awaits the PATCH response before showing it as done (no optimistic update)', async () => {
    let resolvePatch!: (v: { ok: boolean; json: () => Promise<unknown> }) => void
    const patchPromise = new Promise<{ ok: boolean; json: () => Promise<unknown> }>((resolve) => {
      resolvePatch = resolve
    })
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        if (init?.method === 'PATCH') return patchPromise
        return Promise.resolve({ ok: true, json: () => Promise.resolve([reminders[0]]) })
      })
    )
    render(<RemindersSection contactId="contact_1" />)
    await screen.findByText('Follow up pembayaran DP')

    const checkbox = screen.getByLabelText('Tandai "Follow up pembayaran DP" selesai') as HTMLInputElement
    expect(checkbox.checked).toBe(false)
    fireEvent.click(checkbox)

    // Still unchecked before the PATCH resolves.
    expect(checkbox.checked).toBe(false)

    resolvePatch({ ok: true, json: () => Promise.resolve({ id: 'r1', dueAt: '2026-08-01T00:00:00Z', note: 'Follow up pembayaran DP', done: true }) })

    await waitFor(() => expect(checkbox.checked).toBe(true))
    expect(fetch).toHaveBeenCalledWith('/api/contacts/contact_1/reminders', {
      method: 'PATCH',
      body: JSON.stringify({ reminderId: 'r1', done: true }),
    })
  })
})
