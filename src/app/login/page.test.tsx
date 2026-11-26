import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))

import LoginPage from './page'

beforeEach(() => {
  push.mockClear()
  window.history.replaceState(null, '', '/login?next=%2Fantrean')
})

const fill = () => {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.co' } })
  fireEvent.change(screen.getByLabelText('Kata sandi'), { target: { value: 'rahasia' } })
  fireEvent.click(screen.getByRole('button', { name: 'Masuk' }))
}

describe('/login', () => {
  it('memakai desain aplikasi (.nwa) dan logika masuk yang sama: POST /api/auth/login lalu ke ?next=', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const { container } = render(<LoginPage />)
    expect(container.querySelector('.nwa.login .lg-card')).not.toBeNull()
    fill()
    await waitFor(() => expect(push).toHaveBeenCalledWith('/antrean'))
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'a@b.co', password: 'rahasia' }) })
  })

  it('gagal masuk: pesan server tampil sebagai alert, tidak berpindah halaman', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Email atau kata sandi salah' }), { status: 401 })))
    render(<LoginPage />)
    fill()
    expect(await screen.findByRole('alert')).toHaveTextContent('Email atau kata sandi salah')
    expect(push).not.toHaveBeenCalled()
  })

  it('layout memuat CSS dan huruf desain aplikasi', () => {
    const layout = readFileSync(join(__dirname, 'layout.tsx'), 'utf8')
    expect(layout).toContain("import '../(app)/new.css'")
    expect(layout).toContain('Figtree')
  })
})
