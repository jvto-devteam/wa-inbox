'use client'

// Status bersama pratinjau /new. Disimpan di layout /new sehingga bertahan saat pindah
// halaman (navigasi sisi klien); hilang saat reload, sama seperti artifact-nya.
import { createContext, useContext } from 'react'
import type { State, ViewKey } from '@/lib/new/types'

export const ROUTES: Record<ViewKey, string> = {
  hub: '/new/dashboard',
  inbox: '/new/inbox',
  antrean: '/new/antrean',
  ringkasan: '/new/ringkasan',
  agent: '/new/agent',
  kontak: '/new/kontak',
  template: '/new/template',
  laporan: '/new/laporan',
  bot: '/new/bot',
}

export const TITLES: Record<ViewKey, string> = {
  hub: 'Dashboard',
  inbox: 'Inbox',
  antrean: 'Antrean',
  ringkasan: 'Ringkasan',
  kontak: 'Kontak',
  template: 'Template pesan',
  laporan: 'Laporan',
  bot: 'Bot',
  agent: 'Riwayat Agent',
}

export function viewFromPath(pathname: string): ViewKey {
  const hit = (Object.keys(ROUTES) as ViewKey[]).find((k) => pathname === ROUTES[k] || pathname.startsWith(ROUTES[k] + '/'))
  return hit || 'hub'
}

export interface SheetItem {
  label: string
  danger?: boolean
  checked?: boolean
  run: () => void
}

export type DayKey = 'r' | 'a' | 's'

export interface RemReq {
  name: string
  onDone: (off: number, tm: string) => void
}

export interface NewStore {
  s: State
  /** Ubah status lewat salinan (fn boleh memutasi draf). */
  set: (fn: (d: State) => void) => void
  view: ViewKey
  isM: boolean
  /** Ponsel: daftar chat atau isi chat. */
  mstate: 'list' | 'chat'
  go: (v: ViewKey) => void
  toast: (m: string) => void
  flash: (sel: string, text?: string) => void
  sheet: (title: string, items: SheetItem[]) => void
  remind: (req: RemReq) => void
  pickRange: (k: DayKey) => void
  setChatMode: (m: 'list' | 'chat') => void
  toggleInfo: (on?: boolean) => void
}

export const StoreCtx = createContext<NewStore | null>(null)

export function useNew(): NewStore {
  const v = useContext(StoreCtx)
  if (!v) throw new Error('useNew dipakai di luar layout /new')
  return v
}

/** Ketukan baris di ponsel: satu aksi langsung jalan, lebih dari satu = lembar aksi. */
export function useItemTap() {
  const { isM, sheet } = useNew()
  return (title: string, items: SheetItem[]) => (e: React.MouseEvent) => {
    if (!isM || !items.length) return
    if ((e.target as HTMLElement).closest('button,select,input,textarea,a,summary,.agseg')) return
    if (items.length === 1) items[0].run()
    else sheet(title, items)
  }
}
