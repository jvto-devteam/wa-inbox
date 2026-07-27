import { AppNav } from '@/components/AppNav'
import { NotificationListener } from '@/components/NotificationListener'

// Route group (parentheses => it contributes nothing to the URL) covering every page
// src/middleware.ts protects. `/login` and `/` are deliberately outside it.
//
// NotificationListener used to sit in the root layout, so it mounted on the login screen
// too. `/api/sse` is not in middleware's PUBLIC_PATHS, so its EventSource got a 401 there
// and — having no `onerror` handler — the browser's built-in reconnect loop retried an
// endpoint that cannot succeed until the user signs in. It also fired
// Notification.requestPermission() at someone who had not logged in yet.
//
// Gating on the pathname inside the component would have fixed the symptom in fewer lines,
// but it would have made "which pages are authenticated?" a string comparison duplicated
// away from middleware, drifting the moment a route is added. A route group makes the same
// boundary structural: anything that needs a session goes in here and gets the listener,
// anything public stays out and cannot get it by accident. It also mounts cleanly on the
// client-side navigation login does (router.push('/dashboard')), which a pathname read
// inside a mount-once effect would have missed entirely until a hard reload.
//
// It is also where the global nav bar lives, for the same structural reason: "has a session"
// and "has the five top-level menus" are the same set of pages, so the group defines both at
// once instead of every page remembering to render a header.
//
// This file stays a SERVER component. The nav needs usePathname() and two client fetches, but
// putting 'use client' here would make every page under the group a client boundary's child —
// harmless today (they are all 'use client' already) but a constraint the layout has no reason
// to impose on future server pages. Only <AppNav> is a client component.
//
// The h-screen/flex-col wrapper is load-bearing, not decoration. /inbox is a full-height
// three-pane grid; with a header stacked above an h-screen child the document would be
// header + 100vh tall and the whole app would scroll behind a nav bar that scrolled away with
// it. Instead the shell owns the viewport height and hands the rest to the page, which scrolls
// inside it. `min-h-0` is required — a flex child's default min-height:auto refuses to shrink
// below its content, which would push the overflow back out to the document.
export default function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen flex-col">
      <AppNav />
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      <NotificationListener />
    </div>
  )
}
