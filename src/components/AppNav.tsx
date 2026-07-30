'use client'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { fetchJson, redirectToLogin } from '@/lib/fetch-json'
import { cn } from '@/lib/utils'

// The global navigation shell. Every authenticated page renders under it (see
// src/app/(authenticated)/layout.tsx); until this existed, /dashboard, /inbox, /contacts,
// /templates and /settings were only reachable by typing the URL, and there was no way to
// log out anywhere in the app at all.
//
// Structure follows docs/design/wa-inbox-ui-mockup.html: brand + five menus on the left,
// channel health + account on the right. The mockup's hardcoded pills and "AD" avatar are
// replaced with the real /api/numbers/status and /api/session data.

// The five top-level menus mandated by the plan's Global Constraints, in mockup order, plus
// Chatbot -- everything about the bot itself (on/off, knowledge, LLM model, working hours)
// consolidated in one place instead of buried inside the general Pengaturan page.
const NAV_ITEMS = [
  { href: '/dashboard', label: 'Beranda' },
  { href: '/inbox', label: 'Chat / Inbox' },
  { href: '/contacts', label: 'Kontak' },
  { href: '/templates', label: 'Template Pesan' },
  { href: '/chatbot', label: 'Chatbot' },
  { href: '/settings', label: 'Pengaturan' },
] as const

type NumberStatus = { officialTokenValid: boolean; unofficialConnected: boolean }
type Session = { role: 'ADMIN' | 'AGENT'; name: string }

/**
 * A menu is active for its own path and for anything nested beneath it — /contacts/<id>
 * keeps "Kontak" lit, /settings/bot-log keeps "Pengaturan" lit.
 *
 * The nesting test is `startsWith(href + '/')`, not a bare `startsWith(href)`: the bare form
 * matches on any shared character prefix, so a future /contacts-import or /settings-v2 route
 * would light up an unrelated menu. Requiring the separator makes it a path-segment match.
 */
export function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`)
}

/**
 * "Bruno Figarola" -> "BF", "Admin" -> "A". Two initials at most, matching the mockup's
 * "AD" avatar. ContactPanel takes only the first letter because a WhatsApp contact's name is
 * often a single unstructured string; an Account.name is a real person's name entered by an
 * admin, so the second initial is worth having.
 */
export function initialsFrom(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  return words
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join('')
}

export function AppNav() {
  const pathname = usePathname()
  const [status, setStatus] = useState<NumberStatus | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const [logoutError, setLogoutError] = useState<string | null>(null)
  const accountRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Both rejections are swallowed on purpose, the same way the Settings page treats this
    // exact data: a failed probe leaves the badge/avatar unrendered rather than putting an
    // `{ error }` body behind fields typed as booleans and strings. fetchJson has already
    // sent the browser to /login if the cause was a dead session.
    fetchJson<NumberStatus>('/api/numbers/status').then(setStatus).catch(() => {})
    fetchJson<Session>('/api/session').then(setSession).catch(() => {})
  }, [])

  // A dropdown that cannot be dismissed by clicking away is a trap on a bar that sits on
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

  return (
    <header className="flex items-center justify-between border-b border-border bg-white px-5 py-3">
      <div className="flex items-center gap-8">
        <img src="/logo.png" alt="wa-inbox" className="h-8 w-8 rounded object-contain" />
        <nav aria-label="Menu utama" className="flex items-center gap-1">
          {NAV_ITEMS.map((item) => {
            const active = isActivePath(pathname, item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative rounded-lg px-3 py-1.5 text-sm',
                  active
                    ? 'font-semibold text-brand'
                    : 'font-medium text-muted-foreground hover:bg-muted hover:text-foreground'
                )}
              >
                {item.label}
                {active && <span className="absolute -bottom-[13px] left-3 right-3 h-0.5 rounded-full bg-brand" />}
              </Link>
            )
          })}
        </nav>
      </div>

      <div className="flex items-center gap-3">
        {status && (
          <>
            {/* Same copy as the Status nomor card on /settings — one wording for one fact. */}
            <Badge variant={status.officialTokenValid ? 'success' : 'destructive'}>
              <span
                className={cn('size-1.5 rounded-full', status.officialTokenValid ? 'bg-emerald-500' : 'bg-red-500')}
              />
              Official: {status.officialTokenValid ? 'Valid' : 'Tidak valid'}
            </Badge>
            <Badge variant={status.unofficialConnected ? 'success' : 'destructive'}>
              <span
                className={cn('size-1.5 rounded-full', status.unofficialConnected ? 'bg-emerald-500' : 'bg-red-500')}
              />
              Unofficial: {status.unofficialConnected ? 'Tersambung' : 'Terputus'}
            </Badge>
          </>
        )}

        <div ref={accountRef} className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            aria-label={session ? `Akun ${session.name}` : 'Akun'}
            className="flex size-8 items-center justify-center rounded-full bg-navy text-xs font-semibold text-white"
          >
            {session ? initialsFrom(session.name) : '?'}
          </button>

          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 top-10 z-20 w-52 rounded-lg border border-border bg-white p-1 shadow-md"
            >
              {session && (
                <div className="px-2.5 py-1.5">
                  <p className="truncate text-sm font-medium text-navy">{session.name}</p>
                  <p className="text-xs text-muted-foreground">{session.role === 'ADMIN' ? 'Admin' : 'Agen'}</p>
                </div>
              )}
              <button
                type="button"
                role="menuitem"
                onClick={logout}
                disabled={loggingOut}
                className="w-full rounded-md px-2.5 py-1.5 text-left text-sm text-destructive hover:bg-muted disabled:opacity-50"
              >
                {loggingOut ? 'Keluar...' : 'Keluar'}
              </button>
              {logoutError && <p className="px-2.5 py-1 text-xs text-destructive">{logoutError}</p>}
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
