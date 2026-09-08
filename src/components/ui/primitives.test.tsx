import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Avatar, avatarToneFor, initialsOf } from './avatar'
import { Button } from './button'
import { IconButton } from './icon-button'
import { Field, FieldError } from './label'
import { EmptyState } from './empty-state'
import { PageHeader } from './page-header'

/**
 * Yang diuji di sini hanya PERILAKU primitif yang bisa diam-diam hilang saat tampilannya
 * dirombak lagi di Tahap 1B/1C -- bukan kelasnya, bukan warnanya.
 */

describe('Avatar', () => {
  it('memberi nama yang sama nada warna yang sama, dan nama berbeda tidak semuanya sama', () => {
    expect(avatarToneFor('Bruno Figarola')).toBe(avatarToneFor('bruno figarola'))
    expect(avatarToneFor('  Bruno Figarola  ')).toBe(avatarToneFor('Bruno Figarola'))

    const names = ['Bruno Figarola', 'Siti Aminah', 'Wayan Sudira', 'Hendra Wijaya', 'Yuki Tanaka']
    expect(new Set(names.map(avatarToneFor)).size).toBeGreaterThan(1)
  })

  it('tidak pernah melempar untuk nama kosong atau null', () => {
    expect(avatarToneFor(null)).toBeTruthy()
    expect(avatarToneFor('   ')).toBeTruthy()
    expect(initialsOf(null)).toBe('?')
    expect(initialsOf('   ')).toBe('?')
  })

  it('mengambil paling banyak maxInitials huruf pertama, huruf besar', () => {
    expect(initialsOf('bruno figarola')).toBe('BF')
    expect(initialsOf('bruno figarola', 1)).toBe('B')
    expect(initialsOf('bruno   ade  figarola')).toBe('BA')
  })

  it('memakai foto kalau ada, inisial kalau tidak', () => {
    const { rerender } = render(<Avatar name="Bruno Figarola" src="https://x.test/p.jpg" />)
    expect((screen.getByAltText('Bruno Figarola') as HTMLImageElement).src).toBe('https://x.test/p.jpg')

    rerender(<Avatar name="Bruno Figarola" />)
    expect(screen.getByText('BF')).toBeInTheDocument()
  })
})

describe('Button', () => {
  it('tidak mengirim form secara tidak sengaja: type default adalah button', () => {
    render(<Button>Simpan</Button>)
    expect(screen.getByRole('button', { name: 'Simpan' })).toHaveAttribute('type', 'button')
  })

  it('menghormati type yang diberikan pemanggil', () => {
    render(<Button type="submit">Kirim</Button>)
    expect(screen.getByRole('button', { name: 'Kirim' })).toHaveAttribute('type', 'submit')
  })
})

describe('IconButton', () => {
  it('selalu punya nama aksesibel dari label', () => {
    render(<IconButton label="Salin nomor" icon={<svg />} />)
    expect(screen.getByRole('button', { name: 'Salin nomor' })).toBeInTheDocument()
  })
})

describe('Field', () => {
  it('menampilkan galat sebagai alert dan menyembunyikan hint saat ada galat', () => {
    render(
      <Field label="Nomor" htmlFor="n" hint="Awali dengan 62" error="Nomor tidak valid">
        <input id="n" />
      </Field>
    )
    expect(screen.getByRole('alert')).toHaveTextContent('Nomor tidak valid')
    expect(screen.queryByText('Awali dengan 62')).not.toBeInTheDocument()
  })

  it('menampilkan hint saat tidak ada galat', () => {
    render(
      <Field label="Nomor" htmlFor="n" hint="Awali dengan 62">
        <input id="n" />
      </Field>
    )
    expect(screen.getByText('Awali dengan 62')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('menyambungkan label ke kontrolnya', () => {
    render(
      <Field label="Nama tamu" htmlFor="guest">
        <input id="guest" />
      </Field>
    )
    expect(screen.getByLabelText('Nama tamu')).toBeInTheDocument()
  })
})

describe('FieldError', () => {
  it('memakai role alert supaya galat terbaca, bukan hanya terlihat', () => {
    render(<FieldError>Gagal menyimpan</FieldError>)
    expect(screen.getByRole('alert')).toHaveTextContent('Gagal menyimpan')
  })
})

describe('EmptyState', () => {
  it('menampilkan judul, deskripsi opsional, dan aksi opsional', () => {
    const { rerender } = render(<EmptyState title="Belum ada percakapan" />)
    expect(screen.getByText('Belum ada percakapan')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()

    rerender(
      <EmptyState
        title="Tidak ada hasil"
        description="Coba kata kunci lain."
        action={<button type="button">Hapus filter</button>}
      />
    )
    expect(screen.getByText('Coba kata kunci lain.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Hapus filter' })).toBeInTheDocument()
  })
})

describe('PageHeader', () => {
  it('memberi setiap halaman tepat satu <h1>, dan hanya bagian yang diisi', () => {
    const { rerender } = render(<PageHeader title="Kontak" />)

    // Judul halaman adalah level 1. Sebelum komponen ini ada, 17 halaman menuliskannya
    // sendiri-sendiri; satu saja yang salah level membuat daftar heading halaman itu bohong.
    expect(screen.getByRole('heading', { level: 1, name: 'Kontak' })).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()

    rerender(
      <PageHeader
        title="Histori Biaya"
        description="Diambil dari Conversation Analytics."
        backHref="/settings"
        backLabel="Kembali ke Pengaturan"
        actions={<button type="button">Muat ulang</button>}
      />
    )
    expect(screen.getByRole('heading', { level: 1, name: 'Histori Biaya' })).toBeInTheDocument()
    expect(screen.getByText('Diambil dari Conversation Analytics.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Kembali ke Pengaturan' })).toHaveAttribute('href', '/settings')
    expect(screen.getByRole('button', { name: 'Muat ulang' })).toBeInTheDocument()
  })

  it('adalah landmark banner-kurang: satu <header> per halaman, bukan <div> tanpa arti', () => {
    const { container } = render(<PageHeader title="Beranda" />)

    expect(container.querySelector('header')).not.toBeNull()
  })

  it('memberi tautan kembali sebuah label bawaan, bukan panah tanpa teks', () => {
    render(<PageHeader title="Detail" backHref="/contacts" />)

    // Panah sendirian bukan nama aksesibel. Tanpa default ini, sebuah halaman yang lupa
    // mengisi backLabel akan mengirim tautan tanpa nama ke pembaca layar.
    expect(screen.getByRole('link', { name: 'Kembali' })).toHaveAttribute('href', '/contacts')
  })
})
