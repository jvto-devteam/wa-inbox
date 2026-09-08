import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { SectionNav } from './section-nav'

afterEach(() => cleanup())

// Janji inti komponen ini: SATU rupa untuk dua jenis navigasi yang benar-benar berbeda, tanpa
// memalsukan yang satu jadi yang lain. Tiga halaman memakainya, jadi kalau salah satu sisi union
// diam-diam berubah bentuk, yang rusak adalah menu di tiga tempat sekaligus.
describe('SectionNav', () => {
  it('merender item ber-href sebagai tautan asli, bukan tombol yang menavigasi sendiri', () => {
    render(
      <SectionNav
        label="Menu Contoh"
        items={[
          { id: '/a', label: 'Satu', href: '/a' },
          { id: '/b', label: 'Dua', href: '/b' },
        ]}
        activeId="/a"
      />
    )

    // <a href> — bisa dibuka di tab baru dan disalin alamatnya. Sebuah <button> yang memanggil
    // router.push() akan lulus "terlihat sama" dan gagal dua-duanya.
    const link = screen.getByRole('link', { name: 'Satu' })
    expect(link).toHaveAttribute('href', '/a')
    expect(screen.queryByRole('button', { name: 'Satu' })).not.toBeInTheDocument()
  })

  it('merender item ber-onSelect sebagai tombol yang memanggil handler-nya', () => {
    const onSelect = vi.fn()
    render(
      <SectionNav
        label="Menu Contoh"
        items={[
          { id: 'satu', label: 'Satu', onSelect },
          { id: 'dua', label: 'Dua', onSelect: () => {} },
        ]}
        activeId="satu"
      />
    )

    const button = screen.getByRole('button', { name: 'Satu' })
    // `type="button"` wajib: bagian-bagian ini duduk di dalam halaman formulir, dan tombol tanpa
    // type men-submit form terdekatnya saat ditekan.
    expect(button).toHaveAttribute('type', 'button')
    expect(screen.queryByRole('link', { name: 'Satu' })).not.toBeInTheDocument()

    fireEvent.click(button)
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('memakai aria-current yang benar untuk tiap jenis: "page" untuk tautan, "true" untuk tombol', () => {
    // Bukan detail kosmetik: aria-current="page" berarti "ini halaman yang sedang dibuka", dan
    // itu bohong untuk bagian di dalam satu halaman yang sama.
    const { rerender } = render(
      <SectionNav label="Menu Contoh" items={[{ id: '/a', label: 'Satu', href: '/a' }]} activeId="/a" />
    )
    expect(screen.getByRole('link', { name: 'Satu' })).toHaveAttribute('aria-current', 'page')

    rerender(
      <SectionNav label="Menu Contoh" items={[{ id: 'satu', label: 'Satu', onSelect: () => {} }]} activeId="satu" />
    )
    expect(screen.getByRole('button', { name: 'Satu' })).toHaveAttribute('aria-current', 'true')
  })

  it('menandai tepat satu item aktif, dan tidak menandai apa pun kalau activeId tidak cocok', () => {
    const { rerender } = render(
      <SectionNav
        label="Menu Contoh"
        items={[
          { id: 'satu', label: 'Satu', onSelect: () => {} },
          { id: 'dua', label: 'Dua', onSelect: () => {} },
        ]}
        activeId="dua"
      />
    )
    expect(screen.getAllByRole('button').filter((b) => b.getAttribute('aria-current'))).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Dua' })).toHaveAttribute('aria-current', 'true')

    rerender(
      <SectionNav
        label="Menu Contoh"
        items={[
          { id: 'satu', label: 'Satu', onSelect: () => {} },
          { id: 'dua', label: 'Dua', onSelect: () => {} },
        ]}
        activeId={null}
      />
    )
    expect(screen.getAllByRole('button').filter((b) => b.getAttribute('aria-current'))).toHaveLength(0)
  })

  it('menamai nav-nya, karena setiap halaman punya dua nav sekaligus', () => {
    render(<SectionNav label="Bagian pengaturan Chatbot" items={[{ id: 'a', label: 'A', onSelect: () => {} }]} activeId="a" />)

    // AppRail sudah memakai role navigation di halaman yang sama; tanpa nama, pembaca layar
    // mengumumkan dua "navigation" yang tidak bisa dibedakan.
    expect(screen.getByRole('navigation', { name: 'Bagian pengaturan Chatbot' })).toBeInTheDocument()
  })

  it('bisa dipakai dengan keyboard dan punya penanda fokus yang terlihat di kedua jenis item', () => {
    render(
      <SectionNav
        label="Menu Contoh"
        items={[
          { id: '/a', label: 'Tautan', href: '/a' },
          { id: 'b', label: 'Tombol', onSelect: () => {} },
        ]}
        activeId="/a"
      />
    )

    for (const el of [screen.getByRole('link', { name: 'Tautan' }), screen.getByRole('button', { name: 'Tombol' })]) {
      expect(el).not.toHaveAttribute('tabindex')
      el.focus()
      expect(document.activeElement).toBe(el)
      expect(el.className).toMatch(/\bfocus-ring\b/)
    }
  })

  it('di layar sempit menggulung mendatar alih-alih menyembunyikan bagian', () => {
    // Aturan yang gampang hilang saat seseorang "merapikan" sidebar: memotong daftar jadi
    // "3 + Lainnya" atau menyembunyikannya di balik hamburger membuat bagian tidak bisa
    // ditemukan justru di perangkat yang paling sempit. Semua item tetap di DOM, dan
    // pembungkusnya yang menggulung.
    render(
      <SectionNav
        label="Menu Contoh"
        items={['Satu', 'Dua', 'Tiga', 'Empat', 'Lima'].map((label) => ({ id: label, label, onSelect: () => {} }))}
        activeId="Satu"
      />
    )

    expect(screen.getAllByRole('button')).toHaveLength(5)
    expect(screen.getByRole('list').className).toMatch(/\boverflow-x-auto\b/)
  })
})
