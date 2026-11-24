'use client'

// Pembaca/penulis API asli untuk halaman /new yang sudah tersambung data asli (Bot, Template pesan,
// Kontak). Hanya memanggil route yang sudah ada; tidak ada logika server di sini.
import { useEffect, useState } from 'react'
import type { SessionPayload } from '@/lib/auth/session'
import { hasAdminPowers } from '@/lib/bot-control/permissions'

export interface ApiState<T> {
  data?: T
  error?: string
  code?: number
  loading: boolean
  reload: () => void
  /** Ganti data lokal sesudah tulis berhasil, tanpa memuat ulang. */
  setData: (d: T) => void
}

export function useApi<T>(url: string | null): ApiState<T> {
  const [st, setSt] = useState<{ url: string | null; data?: T; error?: string; code?: number }>({ url: null })
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!url) return
    let alive = true
    fetch(url)
      .then(async (r) => {
        const j: unknown = await r.json().catch(() => null)
        if (!alive) return
        if (!r.ok) setSt({ url, error: errorOf(j) || 'Gagal memuat (' + r.status + ')', code: r.status })
        else setSt({ url, data: j as T })
      })
      .catch(() => { if (alive) setSt({ url, error: 'Gagal memuat: jaringan bermasalah' }) })
    return () => { alive = false }
  }, [url, tick])
  const mine = st.url === url
  return {
    data: mine ? st.data : undefined,
    error: mine ? st.error : undefined,
    code: mine ? st.code : undefined,
    loading: !!url && !mine,
    reload: () => setTick((t) => t + 1),
    setData: (d: T) => setSt({ url, data: d }),
  }
}

function errorOf(j: unknown): string | undefined {
  return j && typeof j === 'object' && 'error' in j && typeof (j as { error: unknown }).error === 'string' ? (j as { error: string }).error : undefined
}

/** Panggilan tulis; melempar Error berisi pesan `{ error }` dari server. */
export async function apiSend<T>(url: string, method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', body?: unknown): Promise<T> {
  const r = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const j: unknown = await r.json().catch(() => null)
  if (!r.ok) throw new Error(errorOf(j) || 'Gagal (' + r.status + ')')
  return j as T
}

/** true/false = admin atau bukan; null = belum diketahui. */
export function useIsAdmin(): boolean | null {
  const { data } = useApi<{ role: SessionPayload['role'] }>('/api/session')
  return data ? hasAdminPowers(data.role) : null
}
