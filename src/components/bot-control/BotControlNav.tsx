'use client'
import { usePathname } from 'next/navigation'
import { isActivePath } from '@/components/AppRail'
import { SectionNav } from '@/components/ui/section-nav'

// Sub-navigasi Bot Control.
//
// /bot-control dulu adalah halaman kartu yang seluruh isinya link: satu klik untuk masuk, satu
// klik lagi untuk pindah bagian, dan setiap perpindahan antar-bagian harus kembali dulu ke
// indeks. Setelah kartu Documentation, Triage Queue, dan Releases dihapus, yang tersisa adalah
// delapan halaman — sembilan bagian dengan Ringkasan sendiri. Daftar sependek itu muat
// seluruhnya sebagai menu yang selalu terlihat, sehingga operator pindah bagian langsung dari
// mana pun di dalam Bot Control.
//
// Sejak sidebar kedua, bentuknya BUKAN lagi baris tab melainkan kolom di kiri isi halaman,
// dan rupanya datang dari <SectionNav> — komponen yang sama yang dipakai /chatbot dan
// /settings. Baris tab horizontal masih terpakai di layar sempit, karena itu memang bentuk
// yang sama saat dilipat. Yang berubah hanya rupanya: daftar tujuan, aturan aktif, dan
// <Link> aslinya sama persis seperti sebelumnya.
//
// Yang TIDAK boleh berubah: item di sini adalah rute sungguhan, jadi ia <a href> — bisa
// dibuka di tab baru dan diprefetch. <SectionNav> menyediakan varian tautan tepat untuk itu;
// lihat komentar di src/components/ui/section-nav.tsx.

export const BOT_CONTROL_ROOT = '/bot-control'

/**
 * Sumber kebenaran tautan Bot Control. `layout.test.tsx` membandingkan daftar ini dengan isi
 * direktori `src/app/(authenticated)/bot-control/`, jadi halaman baru yang lupa didaftarkan di
 * sini akan gagal di CI, bukan diam-diam menjadi halaman yatim.
 */
export const BOT_CONTROL_SECTIONS = [
  { href: BOT_CONTROL_ROOT, label: 'Ringkasan' },
  { href: '/bot-control/flows', label: 'Flow Map' },
  { href: '/bot-control/pipeline', label: 'Alur Live' },
  { href: '/bot-control/rules', label: 'Rules' },
  { href: '/bot-control/knowledge', label: 'Knowledge' },
  { href: '/bot-control/decisions', label: 'Decision Logs' },
  { href: '/bot-control/test-lab', label: 'Test Lab' },
  { href: '/bot-control/outbound-queue', label: 'Outbound Queue' },
  { href: '/bot-control/audit-logs', label: 'Audit Logs' },
] as const

/**
 * Penanda aktif untuk satu tab.
 *
 * Rute bersarang memakai `isActivePath` yang sudah dipakai AppRail — /bot-control/decisions/xyz
 * harus tetap menyalakan "Decision Logs", dan aturan segmen di helper itu (`href + '/'`, bukan
 * `startsWith` telanjang) berlaku sama di sini.
 *
 * Ringkasan adalah satu-satunya pengecualian, dan bukan karena aturannya berbeda: /bot-control
 * adalah induk dari semua href lain, jadi aturan "cocok untuk dirinya sendiri dan segala yang
 * bersarang di bawahnya" akan membuatnya menyala di SETIAP bagian. Ia dicocokkan persis.
 */
export function isActiveSection(pathname: string, href: string): boolean {
  if (href === BOT_CONTROL_ROOT) return pathname === BOT_CONTROL_ROOT
  return isActivePath(pathname, href)
}

export function BotControlNav() {
  const pathname = usePathname()
  const activeHref = BOT_CONTROL_SECTIONS.find((section) => isActiveSection(pathname, section.href))?.href ?? null

  return (
    <SectionNav
      label="Menu Bot Control"
      // `id` = `href` dengan sengaja: rute ITU identitas bagian di sini, jadi tidak ada kunci
      // kedua yang bisa berpisah dari daftar yang dijaga layout.test.tsx.
      items={BOT_CONTROL_SECTIONS.map((section) => ({ id: section.href, label: section.label, href: section.href }))}
      activeId={activeHref}
      // `lg:sticky top-0`: cangkangnya menyerahkan gulungan ke area konten, jadi tanpa ini
      // sidebar ikut tergulung ke atas dan operator kehilangan satu-satunya jalan antar-bagian
      // tepat ketika ia sedang jauh di dalam sebuah tabel panjang.
      className="px-3 pt-4 lg:sticky lg:top-0 lg:py-6 lg:pr-0"
    />
  )
}
