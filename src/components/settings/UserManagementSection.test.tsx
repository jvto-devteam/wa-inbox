import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { UserManagementSection } from './UserManagementSection'

const accounts = [
  { id: 'acc_1', name: 'Rina', email: 'rina@jvto.com', role: 'ADMIN' },
  { id: 'acc_2', name: 'Budi', email: 'budi@jvto.com', role: 'AGENT' },
]

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('UserManagementSection', () => {
  it('fetches and renders accounts with name, email, and role — never a password hash', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(accounts) }))
    render(<UserManagementSection />)

    await screen.findByText('Rina')
    expect(screen.getByText('rina@jvto.com')).toBeInTheDocument()
    expect(screen.getByText('Budi')).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledWith('/api/accounts')
    expect(screen.queryByText(/passwordHash/i)).not.toBeInTheDocument()
  })

  it('disables "Tambah Akun" until name, email, and password are filled', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) }))
    render(<UserManagementSection />)
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/accounts'))

    const button = screen.getByRole('button', { name: 'Tambah Akun' })
    expect(button).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Nama'), { target: { value: 'Agen Baru' } })
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'agen@jvto.com' } })
    expect(button).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Kata sandi'), { target: { value: 'Rahasia123' } })
    expect(button).not.toBeDisabled()
  })

  it('POSTs the new account form and only shows it in the list after the server confirms (no optimistic update)', async () => {
    let resolvePost!: (v: { ok: boolean; json: () => Promise<unknown> }) => void
    const postPromise = new Promise<{ ok: boolean; json: () => Promise<unknown> }>((resolve) => {
      resolvePost = resolve
    })
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        if (init?.method === 'POST') return postPromise
        return Promise.resolve({ ok: true, json: () => Promise.resolve(accounts) })
      })
    )
    render(<UserManagementSection />)
    await screen.findByText('Rina')

    fireEvent.change(screen.getByLabelText('Nama'), { target: { value: 'Agen Baru' } })
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'agenbaru@jvto.com' } })
    fireEvent.change(screen.getByLabelText('Kata sandi'), { target: { value: 'Rahasia123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Tambah Akun' }))

    expect(screen.queryByText('agenbaru@jvto.com')).not.toBeInTheDocument()

    resolvePost({ ok: true, json: () => Promise.resolve({ id: 'acc_3', name: 'Agen Baru', email: 'agenbaru@jvto.com', role: 'AGENT' }) })

    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/accounts'))
  })

  it('shows a server error and does not clear the form when creating an account fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        if (init?.method === 'POST') return Promise.resolve({ ok: false, json: () => Promise.resolve({ error: 'Data akun tidak valid' }) })
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
      })
    )
    render(<UserManagementSection />)
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/accounts'))

    fireEvent.change(screen.getByLabelText('Nama'), { target: { value: 'Agen Baru' } })
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'agenbaru@jvto.com' } })
    fireEvent.change(screen.getByLabelText('Kata sandi'), { target: { value: 'Rahasia123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Tambah Akun' }))

    await waitFor(() => expect(screen.getByText('Data akun tidak valid')).toBeInTheDocument())
  })

  it('prompts for a new password and PATCHes it on "Reset Kata Sandi"', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(accounts) }))
    vi.stubGlobal('prompt', vi.fn().mockReturnValue('NewPass123'))
    render(<UserManagementSection />)
    await screen.findByText('Rina')

    fireEvent.click(screen.getAllByRole('button', { name: 'Reset Kata Sandi' })[0])

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith('/api/accounts/acc_1', {
        method: 'PATCH',
        body: JSON.stringify({ password: 'NewPass123' }),
      })
    )
  })

  it('does not call PATCH when the password prompt is cancelled', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(accounts) }))
    vi.stubGlobal('prompt', vi.fn().mockReturnValue(null))
    render(<UserManagementSection />)
    await screen.findByText('Rina')

    fireEvent.click(screen.getAllByRole('button', { name: 'Reset Kata Sandi' })[0])

    await new Promise((r) => setTimeout(r, 0))
    expect(fetch).not.toHaveBeenCalledWith(expect.stringContaining('/api/accounts/acc_1'), expect.objectContaining({ method: 'PATCH' }))
  })

  it('asks for confirmation and DELETEs the account, then refreshes the list, on "Hapus"', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        if (init?.method === 'DELETE') return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) })
        return Promise.resolve({ ok: true, json: () => Promise.resolve(accounts) })
      })
    )
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true))
    render(<UserManagementSection />)
    await screen.findByText('Rina')

    fireEvent.click(screen.getAllByRole('button', { name: 'Hapus' })[0])

    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/accounts/acc_1', { method: 'DELETE' }))
  })

  it('does not call DELETE when the confirmation is declined', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(accounts) }))
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(false))
    render(<UserManagementSection />)
    await screen.findByText('Rina')

    fireEvent.click(screen.getAllByRole('button', { name: 'Hapus' })[0])

    await new Promise((r) => setTimeout(r, 0))
    expect(fetch).not.toHaveBeenCalledWith(expect.stringContaining('/api/accounts/acc_1'), expect.objectContaining({ method: 'DELETE' }))
  })
})
