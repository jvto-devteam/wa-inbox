'use client'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Bot, FileText, Home, MessageSquare, Settings, SlidersHorizontal, Users } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Tooltip } from '@/components/ui/tooltip'
import { GapBell } from '@/components/GapBell'
import { fetchJson, redirectToLogin } from '@/lib/fetch-json'
import { cn } from '@/lib/utils'

// Cangkang navigasi global. Setiap halaman terautentikasi merender di bawahnya (lihat
// src/app/(authenticated)/layout.tsx).
//
// Sampai Tahap 1B ini bentuknya adalah BAR ATAS: logo 64px, tujuh tautan teks, dua lencana
// kesehatan kanal, avatar. Bar itu memakan ~64px tinggi di setiap halaman — termasuk /inbox,
// satu-satunya halaman yang benar-benar butuh tinggi viewport penuh untuk tiga kolomnya.
// Bentuknya sekarang RAIL IKON KIRI, pola yang sama dengan respond.io dan Bird, dengan alasan
// yang sama: ruang horizontal jauh lebih murah daripada ruang vertikal di aplikasi yang isinya
// daftar percakapan.
//
// Daftar tujuannya TIDAK berubah — tujuh yang sama, href yang sama, aturan aktif yang sama.
// Yang berubah hanya bentuknya. `NAV_ITEMS` diekspor supaya test bisa membandingkan daftar itu
// dengan daftar sebelumnya alih-alih mempercayai ingatan.

/**
 * Tujuh tujuan tingkat atas, dalam urutan yang sama seperti bar atas sebelumnya.
 *
 * Ikonnya dari lucide-react, yang SUDAH ada di dependencies (dipakai /dev/design-system);
 * tidak ada pustaka baru yang dipasang untuk ini. Pasangan Chatbot/Bot Control sengaja
 * memakai dua ikon yang tidak mirip (robot vs. slider) karena keduanya adalah label yang
 * paling mudah tertukar di menu ini.
 */
export const NAV_ITEMS: ReadonlyArray<{ href: string; label: string; icon: LucideIcon }> = [
  { href: '/dashboard', label: 'Beranda', icon: Home },
  { href: '/inbox', label: 'Inbox', icon: MessageSquare },
  { href: '/contacts', label: 'Kontak', icon: Users },
  { href: '/templates', label: 'Template Pesan', icon: FileText },
  { href: '/chatbot', label: 'Chatbot', icon: Bot },
  { href: '/bot-control', label: 'Bot Control', icon: SlidersHorizontal },
  { href: '/settings', label: 'Pengaturan', icon: Settings },
] as const

type NumberStatus = { officialTokenValid: boolean; unofficialConfigured: boolean }
type Session = { role: 'ADMIN' | 'AGENT'; name: string }

/**
 * A menu is active for its own path and for anything nested beneath it — /contacts/<id>
 * keeps "Kontak" lit, /settings/knowledge-gaps keeps "Pengaturan" lit.
 *
 * The nesting test is `startsWith(href + '/')`, not a bare `startsWith(href)`: the bare form
 * matches on any shared character prefix, so a future /contacts-import or /settings-v2 route
 * would light up an unrelated menu. Requiring the separator makes it a path-segment match.
 */
export function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`)
}

/**
 * "Bruno Figarola" -> "BF", "Admin" -> "A". Two initials at most. ContactPanel takes only the
 * first letter because a WhatsApp contact's name is often a single unstructured string; an
 * Account.name is a real person's name entered by an admin, so the second initial is worth
 * having.
 */
export function initialsFrom(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  return words
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join('')
}

export function AppRail() {
  const pathname = usePathname()
  const [status, setStatus] = useState<NumberStatus | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const [logoutError, setLogoutError] = useState<string | null>(null)
  const accountRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Both rejections are swallowed on purpose, the same way the Settings page treats this
    // exact data: a failed probe leaves the indicator/avatar unrendered rather than putting an
    // `{ error }` body behind fields typed as booleans and strings. fetchJson has already
    // sent the browser to /login if the cause was a dead session.
    fetchJson<NumberStatus>('/api/numbers/status').then(setStatus).catch(() => {})
    fetchJson<Session>('/api/session').then(setSession).catch(() => {})
  }, [])

  // A dropdown that cannot be dismissed by clicking away is a trap on a rail that sits on
  // every page, so close on outside pointerdown and on Escape.
  useEffect(() => {
    if (!menuOpen) return
    function onPointerDown(e: MouseEvent) {
      if (!accountRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [menuOpen])

  // Genuinely waits for the server before navigating. Redirecting first would race the
  // in-flight POST against a document unload that can cancel it, leaving the session cookie
  // alive on a browser that now shows the login screen — the one failure mode of a logout
  // button that actually matters. On failure we stay put and say so, because sending someone
  // to /login while their cookie is still valid is a lie about their state.
  async function logout() {
    if (loggingOut) return
    setLoggingOut(true)
    setLogoutError(null)
    try {
      const res = await fetch('/api/auth/logout', { method: 'POST' })
      if (!res.ok) {
        setLogoutError('Gagal keluar — coba lagi')
        return
      }
      // Hard navigation rather than router.push, for the same reason fetch-json documents:
      // a soft navigation keeps the open EventSource and every cached list alive across
      // what is supposed to be the end of the session.
      redirectToLogin()
    } catch {
      setLogoutError('Gagal keluar — coba lagi')
    } finally {
      setLoggingOut(false)
    }
  }

  const channelsHealthy = status?.officialTokenValid === true && status?.unofficialConfigured === true
  const channelSummary = status
    ? `Official: ${status.officialTokenValid ? 'Valid' : 'Tidak valid'} · Unofficial: ${
        status.unofficialConfigured ? 'Terkonfigurasi' : 'Belum diatur'
      }`
    : null

  return (
    // Satu elemen untuk dua bentuk, bukan dua salinan yang di-hide bergantian: setiap tujuan
    // hanya boleh ada SEKALI di DOM, kalau tidak pembaca layar mengumumkan tujuh menu dua kali
    // dan `getByRole('link', { name })` menjadi ambigu.
    //
    // Di bawah md ia adalah bar bawah (flex baris); dari md ke atas ia rail kiri (flex kolom).
    // Pembalikan posisinya diurus oleh layout grup rute lewat flex-col-reverse -> md:flex-row,
    // jadi tidak ada `fixed` dan tidak ada padding-bottom kompensasi yang bisa meleset.
    <div
      className={cn(
        // Tidak ada garis pemisah di sini, dan itu bukan kelalaian: aturan "garis rambut
        // memisahkan, bukan bayangan" berlaku untuk dua permukaan yang sewarna. Rail navy di
        // sebelah canvas abu terang sudah terpisah oleh warnanya sendiri; menambah garis di
        // atasnya hanya menggambar batas kedua di tempat yang sudah punya satu.
        'flex h-14 w-full shrink-0 flex-row items-center gap-1 bg-ink px-1',
        'md:h-full md:w-16 md:flex-col md:items-stretch md:gap-2 md:px-0 md:py-2'
      )}
    >
      {/* Logo: 64px di bar atas lama, 28px di sini. Di bar bawah ponsel ia disembunyikan —
          setiap piksel horizontal di sana dipakai untuk tujuan, dan merek tidak perlu
          diumumkan ke operator yang sudah masuk. */}
      <Link
        href="/dashboard"
        aria-label="wa-inbox — beranda"
        className="focus-ring-inverse hidden shrink-0 items-center justify-center rounded-md py-1 md:flex"
      >
        <img src="/logo.png" alt="" className="size-7 rounded object-contain" />
      </Link>

      <nav
        aria-label="Menu utama"
        className={cn(
          // Di ponsel tujuh tujuan × 64px = 448px, lebih lebar dari layar 390px, jadi barisnya
          // menggulung mendatar. Itu pilihan sadar: memotong daftar menjadi "5 + Lainnya"
          // menyembunyikan dua tujuan di balik ketukan kedua, dan menyembunyikan labelnya
          // membuat rail tidak bisa dipelajari justru di perangkat yang tidak punya hover.
          'flex min-w-0 flex-1 flex-row items-stretch gap-0.5 overflow-x-auto',
          'md:w-full md:flex-none md:flex-col md:gap-0.5 md:overflow-x-visible md:overflow-y-auto md:px-1'
        )}
      >
        {NAV_ITEMS.map((item) => {
          const active = isActivePath(pathname, item.href)
          const Icon = item.icon
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'focus-ring-inverse flex w-16 shrink-0 flex-col items-center justify-start gap-1 rounded-md px-0.5 py-2',
                'text-center text-[10px] leading-[1.15] font-medium tracking-tight transition-colors',
                'md:w-full',
                active
                  ? // Satu dari tiga tempat aksen boleh dibelanjakan (aturan 2 sistem desain).
                    // Putih di atas --color-accent = 6.6:1, jauh di atas ambang teks kecil.
                    'bg-accent text-white'
                  : 'text-white/70 hover:bg-white/10 hover:text-white'
              )}
            >
              <Icon aria-hidden="true" className="size-[18px] shrink-0" strokeWidth={1.75} />
              {/* Label SELALU terlihat, dan ia adalah nama aksesibel tautan ini — bukan
                  aria-label terpisah yang bisa menyimpang dari yang terbaca di layar. */}
              <span className="w-full">{item.label}</span>
            </Link>
          )
        })}
      </nav>

      {/* Lonceng gap: DI LUAR <nav>, dan itu load-bearing. Isinya popover `absolute` yang dibuka
          di luar kotak tombolnya (ke atas di ponsel, ke kanan di desktop), sementara <nav> di
          atas menggulung — `overflow-x-auto` di ponsel, dan di desktop `md:overflow-x-visible`
          yang dihitung ulang CSS menjadi `auto` karena berpasangan dengan `md:overflow-y-auto`.
          Leluhur yang menggulung MEMOTONG popover: menunya tetap ada di DOM (jadi tidak ada test
          render yang gagal) tapi tidak pernah terlihat operator. Tempatnya sekarang sama dengan
          menu akun di bawah, yang memang selalu tampil. Bonus di ponsel: lonceng tidak lagi ikut
          menggulung menjauh — notifikasi yang harus dicari dengan menggeser adalah notifikasi
          yang terlewat. Bukan tautan, karena isinya daftar yang dibuka di tempat. */}
      <GapBell />

      {/* Kesehatan kanal. Di bar atas lama ini dua lencana teks penuh yang selalu menyala hijau
          di setiap halaman; di rail ia menyusut jadi satu titik dengan tooltip, dan menjadi
          tautan ke /settings tempat fakta lengkapnya berada. Disembunyikan di ponsel: tooltip
          tidak punya hover di sana, dan /dashboard menampilkan kedua lencana yang sama. */}
      {status && (
        <Tooltip content={channelSummary} side="right" className="hidden md:inline-flex md:justify-center">
          <Link
            href="/settings"
            aria-label={`Status kanal — ${channelSummary}`}
            className="focus-ring-inverse flex size-8 items-center justify-center rounded-md hover:bg-white/10"
          >
            <span
              aria-hidden="true"
              className={cn('size-2 rounded-full', channelsHealthy ? 'bg-success' : 'bg-danger')}
            />
          </Link>
        </Tooltip>
      )}

      <div ref={accountRef} className="relative shrink-0 md:mt-auto md:self-center">
        <button
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          aria-label={session ? `Akun ${session.name}` : 'Akun'}
          className="focus-ring-inverse flex size-8 items-center justify-center rounded-full bg-white/15 text-xs font-semibold text-white hover:bg-white/25"
        >
          {session ? initialsFrom(session.name) : '?'}
        </button>

        {menuOpen && (
          // Overlay sungguhan, jadi ia berhak atas --shadow-popover (satu dari dua bayangan
          // yang tersisa di sistem ini). Arah bukanya mengikuti bentuk rail: ke atas di bar
          // bawah ponsel, ke kanan di rail desktop — dua-duanya menjauh dari tepi layar.
          <div
            role="menu"
            className={cn(
              'absolute right-0 bottom-full z-30 mb-2 w-52 rounded-lg border border-line bg-surface p-1 shadow-popover',
              'md:right-auto md:bottom-0 md:left-full md:mb-0 md:ml-2'
            )}
          >
            {session && (
              <div className="px-2.5 py-1.5">
                <p className="truncate text-sm font-medium text-ink">{session.name}</p>
                <p className="text-xs text-ink-muted">{session.role === 'ADMIN' ? 'Admin' : 'Agen'}</p>
              </div>
            )}
            <button
              type="button"
              role="menuitem"
              onClick={logout}
              disabled={loggingOut}
              className="focus-ring w-full rounded-md px-2.5 py-1.5 text-left text-sm text-danger hover:bg-surface-sunken disabled:opacity-50"
            >
              {loggingOut ? 'Keluar...' : 'Keluar'}
            </button>
            {logoutError && <p className="px-2.5 py-1 text-xs text-danger">{logoutError}</p>}
          </div>
        )}
      </div>
    </div>
  )
}
