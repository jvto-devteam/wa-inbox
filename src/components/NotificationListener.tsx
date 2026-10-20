'use client'
import { useCallback, useEffect, useState } from 'react'

// Base64url -> Uint8Array untuk applicationServerKey.
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

const pushSupported = () =>
  typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && typeof Notification !== 'undefined'

export function NotificationListener() {
  // Tombol hanya tampil bila push didukung dan belum ada langganan aktif. Izin TIDAK diminta
  // otomatis: iOS hanya mengizinkan dari gestur pengguna.
  const [needsEnable, setNeedsEnable] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (pushSupported()) {
      navigator.serviceWorker
        .register('/sw.js')
        .then(() => navigator.serviceWorker.ready)
        .then((reg) => reg.pushManager.getSubscription())
        .then((sub) => setNeedsEnable(Notification.permission !== 'granted' || !sub))
        .catch(() => setNeedsEnable(true))
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

  const enable = useCallback(async () => {
    setBusy(true)
    setFailed(false)
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') throw new Error('izin ditolak')
      const keyRes = await fetch('/api/push/vapid-public-key')
      if (!keyRes.ok) throw new Error('kunci tidak tersedia')
      const { publicKey } = (await keyRes.json()) as { publicKey: string }
      const reg = await navigator.serviceWorker.ready
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) }))
      const json = sub.toJSON()
      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
      })
      if (!res.ok) throw new Error('simpan gagal')
      setNeedsEnable(false)
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }, [])

  if (!needsEnable) return null
  return (
    <div className="fixed bottom-20 right-3 z-50 md:bottom-4 md:right-4">
      <button
        type="button"
        onClick={enable}
        disabled={busy}
        className="min-h-11 rounded-lg bg-ink px-4 text-sm font-medium text-white shadow-lg disabled:opacity-60"
      >
        {busy ? 'Menyalakan…' : failed ? 'Gagal, coba lagi' : 'Nyalakan notifikasi'}
      </button>
    </div>
  )
}
