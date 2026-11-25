'use client'

// Pembungkus komponen halaman LAMA yang dipasang di /new apa adanya: memberi kulit desain /new (CSS .legacy-skin di
// new.css: variabel tema lama dipetakan ke token /new) dan menjaga tautan di dalamnya tetap di /new (peta di
// lib/new/legacy-routes.ts). Komponen lamanya tidak diubah. Klik dengan Ctrl/⌘/Shift atau target lain dibiarkan.
import { useRouter } from 'next/navigation'
import { newPathFor } from '@/lib/new/legacy-routes'

export function LegacyFrame({ className, children }: { className?: string; children: React.ReactNode }) {
  const router = useRouter()
  const keepInNew = (e: React.MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    const a = (e.target as HTMLElement).closest('a')
    if (!a || (a.target && a.target !== '_self')) return
    const url = new URL(a.getAttribute('href') ?? '', window.location.href)
    if (url.origin !== window.location.origin) return
    const to = newPathFor(url.pathname)
    if (!to) return
    e.preventDefault()
    e.stopPropagation()
    router.push(to + url.search + url.hash)
  }
  return <div className={'legacy-skin' + (className ? ' ' + className : '')} onClickCapture={keepInNew}>{children}</div>
}
