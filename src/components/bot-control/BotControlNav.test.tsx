import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { BotControlNav, BOT_CONTROL_SECTIONS, isActiveSection } from './BotControlNav'

const pathname = vi.fn(() => '/bot-control')
vi.mock('next/navigation', () => ({ usePathname: () => pathname() }))

beforeEach(() => {
  pathname.mockReturnValue('/bot-control')
})

afterEach(() => cleanup())

describe('isActiveSection', () => {
  it('menyalakan bagian untuk rutenya sendiri dan untuk rute bersarang di bawahnya', () => {
    expect(isActiveSection('/bot-control/decisions', '/bot-control/decisions')).toBe(true)
    expect(isActiveSection('/bot-control/decisions/run_7', '/bot-control/decisions')).toBe(true)
  })

  it('tidak menyalakan bagian lain yang kebetulan berbagi awalan karakter', () => {
    // Aturan segmen ini datang dari isActivePath milik AppRail, yang dipakai ulang di sini
    // supaya tidak ada dua logika "halaman aktif" yang bisa berbeda.
    expect(isActiveSection('/bot-control/rules-archive', '/bot-control/rules')).toBe(false)
    expect(isActiveSection('/bot-control/flows', '/bot-control/rules')).toBe(false)
  })

  it('mencocokkan Ringkasan secara persis, karena ia induk dari semua bagian lain', () => {
    expect(isActiveSection('/bot-control', '/bot-control')).toBe(true)
    // Aturan "dirinya sendiri + segala yang bersarang" akan membuat Ringkasan menyala di
    // setiap halaman Bot Control, jadi dua tab aktif sekaligus.
    expect(isActiveSection('/bot-control/rules', '/bot-control')).toBe(false)
  })
})

describe('BotControlNav', () => {
  it('merender setiap bagian sebagai link asli ke rutenya', () => {
    render(<BotControlNav />)

    for (const section of BOT_CONTROL_SECTIONS) {
      expect(screen.getByRole('link', { name: section.label })).toHaveAttribute('href', section.href)
    }
  })

  it('menandai bagian untuk rute saat ini sebagai halaman aktif', () => {
    pathname.mockReturnValue('/bot-control/knowledge')
    render(<BotControlNav />)

    expect(screen.getByRole('link', { name: 'Knowledge' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Ringkasan' })).not.toHaveAttribute('aria-current')
  })

  it('mempertahankan bagian induk yang aktif pada rute bersarang', () => {
    pathname.mockReturnValue('/bot-control/decisions/run_7')
    render(<BotControlNav />)

    expect(screen.getByRole('link', { name: 'Decision Logs' })).toHaveAttribute('aria-current', 'page')
    // Tepat satu tab yang aktif — termasuk di halaman bersarang, tempat Ringkasan paling mudah
    // ikut menyala kalau pencocokannya salah.
    expect(screen.getAllByRole('link').filter((a) => a.getAttribute('aria-current') === 'page')).toHaveLength(1)
  })

  it('menyalakan Ringkasan hanya di /bot-control', () => {
    render(<BotControlNav />)

    expect(screen.getByRole('link', { name: 'Ringkasan' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getAllByRole('link').filter((a) => a.getAttribute('aria-current') === 'page')).toHaveLength(1)
  })

  it('bisa dipakai dengan keyboard dan punya penanda fokus yang terlihat', () => {
    render(<BotControlNav />)

    const link = screen.getByRole('link', { name: 'Test Lab' })
    // <a href> ikut urutan tab bawaan; tidak ada tabIndex yang mengeluarkannya dari sana.
    expect(link).not.toHaveAttribute('tabindex')
    link.focus()
    expect(document.activeElement).toBe(link)
    // Penanda fokus harus ada — kalau tidak, tab ini tidak punya penanda fokus sama sekali.
    // Bentuknya berubah di Tahap 1B: sebelumnya cincin `focus-visible:ring-3` buatan bar ini
    // sendiri, sekarang `.focus-ring` milik sistem desain Tahap 1A (outline 2px aksen,
    // didefinisikan di globals.css). Janjinya sama — ada penanda fokus yang terlihat — dan
    // sekarang ia janji yang sama persis dengan seluruh kontrol lain di aplikasi.
    expect(link.className).toMatch(/\bfocus-ring\b/)
  })
})
