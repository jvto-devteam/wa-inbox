import Link from 'next/link'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

// Sidebar kedua: daftar bagian di kiri, isi bagian yang dipilih di kanan.
//
// Tiga halaman memakainya — /chatbot, /settings, dan /bot-control/** — dan semuanya dulu
// menyusun isinya sebagai grid dua kolom. Grid itu tidak pernah sejajar: bagian yang isinya
// satu <select> berdiri di sebelah bagian yang isinya tabel katalog, jadi tiap barisnya
// setinggi bagian terpanjang dan setengah halaman jadi ruang kosong. Pemilik membacanya
// sebagai "kayak asal taruh aja" dibanding Beranda/Inbox/Kontak/Template. Satu bagian pada
// satu waktu menghapus masalah itu sekaligus memberi tiap bagian lebar penuh.
//
// --- Kenapa SATU komponen untuk dua jenis navigasi yang berbeda ---
//
// Dua pemakaiannya benar-benar berbeda di bawah kap:
//   - Chatbot & Pengaturan: bagian-bagian di dalam SATU halaman. Menekan item mengganti state
//     React; tidak ada URL yang berubah, tidak ada yang bisa dibuka di tab baru.
//   - Bot Control: sembilan RUTE sungguhan. Item harus <a href> asli — dibuka di tab baru,
//     disalin alamatnya, dan diprefetch Next.js.
//
// Yang sama dari keduanya hanya rupanya dan perilaku fokus/gulungnya, dan itulah tepatnya yang
// harus tidak boleh berbeda antar-halaman. Maka `items` adalah union yang JUJUR: sebuah item
// punya `href` (dirender <Link>) ATAU `onSelect` (dirender <button>), tidak pernah dua-duanya.
// Alternatif yang ditolak:
//   - `onSelect` saja, dengan Bot Control memanggil router.push(): tombol yang tidak bisa
//     dibuka di tab baru, kehilangan menu konteks, dan tidak diprefetch. Tautan palsu.
//   - `href` saja, dengan Chatbot memakai `#anchor`: mengotori URL dengan state yang bukan
//     rute, dan menyalakan lompatan scroll bawaan browser di halaman formulir.
//   - dua komponen kembar: persis cara tiga navigasi ini berpisah pelan-pelan, yang sedang
//     diperbaiki di sini.
//
// `aria-current` mengikuti bedanya: "page" untuk tautan (itu memang halaman lain), "true"
// untuk tombol (bagian di halaman yang sama, bukan halaman).
//
// SENGAJA TANPA 'use client'. Komponennya sendiri tidak memakai hook apa pun; halaman yang
// memanggilnya dengan `onSelect` sudah client component, dan layout Bot Control yang server
// component hanya memakai <SectionNavLayout>/<SectionNavPane> di sini. Menambahkan direktifnya
// akan memaksa batas client pada layout itu tanpa alasan.

type SectionNavItemBase = {
  /** Kunci React sekaligus nilai yang dibandingkan dengan `activeId`. */
  id: string
  label: string
}

export type SectionNavItem =
  | (SectionNavItemBase & { href: string; onSelect?: never })
  | (SectionNavItemBase & { onSelect: () => void; href?: never })

/**
 * Pembungkus dua panel: nav di kiri, isi di kanan.
 *
 * Di bawah `lg` ia kolom — nav menjadi baris di ATAS isinya, bukan menghilang di balik tombol
 * hamburger. Pola yang sama dengan <AppRail> di ponsel dan baris tab Bot Control sebelumnya:
 * daftar sependek ini lebih baik menggulung mendatar daripada disembunyikan di balik ketukan
 * kedua.
 */
export function SectionNavLayout({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-6', className)}>{children}</div>
}

/**
 * Kolom isi di sebelah kanan nav.
 *
 * `min-w-0` load-bearing, bukan hiasan: default `min-width: auto` pada flex item menolak
 * menyusut di bawah kontennya, jadi tanpa ini satu tabel lebar (katalog paket, antrean
 * outbound) mendorong seluruh halaman melebar dan sidebar-nya ikut terseret keluar layar.
 */
export function SectionNavPane({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('min-w-0 flex-1', className)}>{children}</div>
}

export function SectionNav({
  label,
  items,
  activeId,
  className,
}: {
  /** Isi `aria-label` nav — sebutkan halamannya, karena tiap halaman punya dua nav (rail + ini). */
  label: string
  items: readonly SectionNavItem[]
  activeId: string | null
  className?: string
}) {
  return (
    <nav aria-label={label} className={cn('lg:w-56 lg:shrink-0', className)}>
      <ul
        className={cn(
          // Layar sempit: satu baris yang menggulung mendatar. Memotongnya jadi "3 + Lainnya"
          // menyembunyikan bagian di balik ketukan kedua di perangkat yang paling butuh
          // daftarnya terlihat.
          //
          // `-m-1 p-1` bukan hiasan: `overflow-x-auto` membuat overflow-y ikut memotong, dan
          // .focus-ring berdiri 3px di luar tombolnya (outline 2px + offset 1px). Tanpa ruang
          // ini, penanda fokus item pertama dan terakhir terpotong justru di bentuk yang paling
          // sering dipakai dengan keyboard eksternal. Margin negatifnya mengembalikan posisinya
          // supaya tidak ada pergeseran yang terlihat.
          'flex -m-1 gap-1 overflow-x-auto p-1',
          'lg:m-0 lg:flex-col lg:gap-0.5 lg:overflow-x-visible lg:p-0'
        )}
      >
        {items.map((item) => {
          const active = item.id === activeId
          const classes = cn(
            'focus-ring block w-full rounded-md px-3 py-2 text-left text-sm whitespace-nowrap transition-colors',
            active
              ? // Satu dari tiga tempat aksen boleh dibelanjakan (aturan 2 sistem desain):
                // state nav aktif. Tidak ada aksen kedua di dalam nav ini.
                'bg-accent-subtle font-medium text-accent'
              : 'font-medium text-ink-muted hover:bg-surface-sunken hover:text-ink'
          )
          return (
            <li key={item.id} className="shrink-0">
              {item.href !== undefined ? (
                <Link href={item.href} aria-current={active ? 'page' : undefined} className={classes}>
                  {item.label}
                </Link>
              ) : (
                <button type="button" onClick={item.onSelect} aria-current={active ? 'true' : undefined} className={classes}>
                  {item.label}
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
