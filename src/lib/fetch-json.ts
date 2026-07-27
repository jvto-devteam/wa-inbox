// Shared client-side JSON fetch.
//
// Every client component used to do a bare `fetch(url).then((r) => r.json()).then(setState)`.
// src/middleware.ts answers an expired/revoked session on any `/api/*` route with a 401
// `{ error: 'Unauthorized' }` body, so that pattern quietly fed an error object into state
// that the component then treated as an array/record — `summary.remindersDue.length` and
// `conversations.map` both throw on it, crashing the page instead of sending the agent back
// to the login screen.
//
// This helper is the one place that decides what a non-ok response means:
//   401 -> the session is gone; hard-navigate to /login.
//   any other non-ok -> throw a typed error the caller can surface or ignore.
//   ok -> parsed JSON, exactly as before.

const LOGIN_PATH = '/login'

export class FetchJsonError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'FetchJsonError'
    this.status = status
  }
}

// `globalThis.location.href = ...` rather than Next's `useRouter().push()`:
//
// 1. This is a plain module function called from effects, event handlers and non-component
//    helpers (ConversationList's module-level `loadConversations`, for one). `useRouter()` is
//    a hook — it can only be read inside a component body, so using it here would mean
//    threading a router instance through every call site.
// 2. A dead session should tear the client down, not soft-navigate. `router.push` keeps the
//    same JS context alive, so every already-open EventSource, in-flight poll and stale
//    cached list survives the "logout" and keeps hammering endpoints that now 401. A full
//    document load drops all of it.
//
// Read through `globalThis` (rather than `window`) so it is stubbable in jsdom tests.
export function redirectToLogin(): void {
  if (typeof globalThis.location === 'undefined') return
  // Guard against a redirect loop if something on the login screen ever calls an API.
  if (globalThis.location.pathname === LOGIN_PATH) return
  globalThis.location.href = LOGIN_PATH
}

export async function fetchJson<T>(input: string, init?: RequestInit): Promise<T> {
  // Deliberately not `fetch(input, init)`: that would turn every plain GET into a two-argument
  // `fetch(url, undefined)` call. The request is identical either way, but this keeps the
  // observable call shape byte-for-byte what each site issued before the helper existed.
  const res = init === undefined ? await fetch(input) : await fetch(input, init)

  if (res.status === 401) {
    redirectToLogin()
    throw new FetchJsonError(401, 'Sesi berakhir')
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    throw new FetchJsonError(res.status, body?.error ?? 'Permintaan gagal')
  }

  return (await res.json()) as T
}
