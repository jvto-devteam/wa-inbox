'use client'

import { useEffect, useState } from 'react'
import type { Report } from '@/lib/new/report'

/** Laporan inquiry → booking (data asli) untuk rentang [from, to]; dipakai Laporan dan Dashboard /new. */
export function useReport(from: string, to: string): { loading: boolean; data?: Report; error?: string } {
  const key = from + '_' + to
  const [res, setRes] = useState<{ key: string; data?: Report; error?: string } | null>(null)
  useEffect(() => {
    let alive = true
    fetch(`/api/new/report?from=${from}&to=${to}`)
      .then(async (r) => {
        const j = await r.json()
        if (!alive) return
        if (!r.ok) setRes({ key, error: (j && j.error) || 'Gagal memuat laporan' })
        else setRes({ key, data: j as Report })
      })
      .catch(() => { if (alive) setRes({ key, error: 'Gagal memuat laporan' }) })
    return () => { alive = false }
  }, [from, to, key])
  const loading = !res || res.key !== key
  return { loading, data: loading ? undefined : res?.data, error: loading ? undefined : res?.error }
}
