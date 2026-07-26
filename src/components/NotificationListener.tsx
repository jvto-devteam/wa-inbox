'use client'
import { useEffect } from 'react'

export function NotificationListener() {
  useEffect(() => {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission()
    }

    const es = new EventSource('/api/sse')
    es.onmessage = (e) => {
      const event = JSON.parse(e.data)
      if (event.type === 'handoff.alert') {
        new Audio('/notification.mp3').play().catch(() => {})
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          new Notification('Percakapan butuh agen', { body: event.contactName ?? 'Pelanggan baru' })
        }
      }
    }
    return () => es.close()
  }, [])

  return null
}
