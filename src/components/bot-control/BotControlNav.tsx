'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { isActivePath } from '@/components/AppNav'
import { cn } from '@/lib/utils'

// Sub-navigasi Bot Control.
//
// /bot-control dulu adalah halaman kartu yang seluruh isinya link: satu klik untuk masuk, satu
// klik lagi untuk pindah bagian, dan setiap perpindahan antar-bagian harus kembali dulu ke
// indeks. Setelah kartu Documentation, Triage Queue, dan Releases dihapus, yang tersisa adalah
// delapan halaman — sembilan tab dengan Ringkasan sendiri. Daftar sependek itu muat sebagai
// baris tab yang selalu terlihat, sehingga operator pindah bagian langsung dari mana pun di
// dalam Bot Control.
//
// Bentuknya sengaja meniru <AppNav>: satu <nav aria-label>, <Link> asli (bukan tombol yang
// tidak menavigasi), aria-current="page" pada yang aktif, dan garis brand di bawahnya. Ini
// satu-satunya pola navigasi di repo ini; menambah pola kedua hanya membuat dua hal yang
// terlihat mirip berperilaku beda.

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
 * Rute bersarang memakai `isActivePath` yang sudah dipakai AppNav — /bot-control/decisions/xyz
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

  return (
    <nav
      aria-label="Menu Bot Control"
      className="flex items-center gap-1 overflow-x-auto border-b border-border bg-white px-6"
    >
      {BOT_CONTROL_SECTIONS.map((section) => {
        const active = isActiveSection(pathname, section.href)
        return (
          <Link
            key={section.href}
            href={section.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'relative shrink-0 rounded-lg px-3 py-2.5 text-sm outline-none',
              // Fokus keyboard memakai cincin brand yang sama dengan Input/Textarea, karena
              // outline default dimatikan dan tab tanpa penanda fokus adalah jebakan pada bar
              // yang muncul di setiap halaman.
              'focus-visible:ring-3 focus-visible:ring-brand/30 focus-visible:text-brand',
              active
                ? 'font-semibold text-brand'
                : 'font-medium text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
          >
            {section.label}
            {active && <span className="absolute bottom-0 left-3 right-3 h-0.5 rounded-full bg-brand" />}
          </Link>
        )
      })}
    </nav>
  )
}
