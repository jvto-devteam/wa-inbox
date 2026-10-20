/* Service worker wa-inbox: HANYA Web Push (tanpa cache/offline). */
self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = {}
  }
  const title = typeof data.title === 'string' ? data.title : 'wa-inbox'
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof data.body === 'string' ? data.body : '',
      tag: typeof data.tag === 'string' ? data.tag : undefined,
      icon: '/icon-192.png',
      data: { url: typeof data.url === 'string' ? data.url : '/inbox' },
    })
  )
})

// Ambil kendali tab yang sudah terbuka, supaya client.navigate() tidak ditolak pada jendela
// yang belum dikendalikan SW ini.
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

// Hanya URL satu origin yang diterima; selain itu buka /inbox.
function safeTarget(raw) {
  try {
    const u = new URL(raw, self.location.origin)
    if (u.origin === self.location.origin) return u.href
  } catch {
    // jatuh ke default
  }
  return new URL('/inbox', self.location.origin).href
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = safeTarget(event.notification.data && event.notification.data.url)
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (windows) => {
      const existing = windows.find((w) => new URL(w.url).origin === self.location.origin)
      if (existing) {
        try {
          const focused = await existing.focus()
          await (focused || existing).navigate(target)
          return undefined
        } catch {
          // navigate() ditolak pada jendela yang tidak dikendalikan: buka jendela baru.
        }
      }
      return self.clients.openWindow(target)
    })
  )
})
