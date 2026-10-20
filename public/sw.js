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

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = new URL((event.notification.data && event.notification.data.url) || '/inbox', self.location.origin).href
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const existing = windows.find((w) => new URL(w.url).origin === self.location.origin)
      if (existing) {
        return existing.focus().then((c) => (c && 'navigate' in c ? c.navigate(target) : undefined))
      }
      return self.clients.openWindow(target)
    })
  )
})
