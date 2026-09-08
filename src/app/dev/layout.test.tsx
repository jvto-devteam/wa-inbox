import { describe, it, expect, vi, afterEach } from 'vitest'

// notFound() milik Next melempar error dengan digest internal; yang perlu diuji di sini
// bukan bentuk error-nya, tapi bahwa gerbangnya benar-benar memanggilnya.
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
}))

import DevLayout from './layout'

/**
 * /dev/* adalah alat kerja internal tanpa login -- mis. /dev/design-system. Kalau gerbang ini
 * lepas, halaman itu ikut terbit ke produksi dan bisa dibuka siapa pun tanpa autentikasi.
 * Karena itu gerbangnya diuji, bukan sekadar ditulis.
 */
describe('gerbang /dev', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('menutup seluruh /dev di produksi', () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(() => DevLayout({ children: null })).toThrow('NEXT_NOT_FOUND')
  })

  it('membuka /dev di luar produksi', () => {
    vi.stubEnv('NODE_ENV', 'development')
    expect(() => DevLayout({ children: null })).not.toThrow()
  })
})
