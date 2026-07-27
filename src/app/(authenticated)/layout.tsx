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
export default function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <NotificationListener />
    </>
  )
}
