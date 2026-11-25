'use client'

// Inbox /new = Inbox ASLI (src/components/inbox/InboxScreen: daftar chat, isi chat, kotak balasan, panel kontak)
// dengan kulit desain /new. Tidak ada logika di sini: membalas, bot, template, jendela 24 jam, lampiran, dan mode uji
// semuanya milik komponen Inbox yang sama dengan /inbox. Kulitnya hanya CSS (.inbox-real di new.css) yang memetakan
// variabel warna/huruf/sudut Inbox lama ke token /new.
import { Suspense, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { InboxScreen } from '@/components/inbox/InboxScreen'
import { useNew } from '../store'

export function InboxView() {
  const st = useNew()
  const { setChatMode } = st
  // Di ponsel, bar atas dan bar tab bawah /new disembunyikan selagi satu chat terbuka (sama dengan tampilan contoh).
  const onSelectedChange = useCallback((id: string | null) => setChatMode(id ? 'chat' : 'list'), [setChatMode])
  const router = useRouter()
  // Tautan di dalam komponen Inbox yang menunjuk /inbox?... (mis. butir Ringkasan chat, kartu booking) tetap dibuka di
  // /new/inbox dengan parameter yang sama, tanpa mengubah komponennya. Klik dengan Ctrl/⌘ atau tab baru dibiarkan.
  const keepInNew = (e: React.MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    const a = (e.target as HTMLElement).closest('a')
    if (!a || (a.target && a.target !== '_self')) return
    const url = new URL(a.getAttribute('href') ?? '', window.location.href)
    if (url.origin !== window.location.origin || url.pathname !== '/inbox') return
    e.preventDefault()
    e.stopPropagation()
    router.push('/new/inbox' + url.search + url.hash)
  }
  return (
    <section className={'view fx' + (st.mstate === 'chat' ? ' m-chat' : '')} id="v-inbox">
      <div className="inbox-real" onClickCapture={keepInNew}>
        <Suspense fallback={<div className="mut" style={{ padding: 16 }}>Memuat inbox…</div>}>
          <InboxScreen basePath="/new/inbox" onSelectedChange={onSelectedChange} />
        </Suspense>
      </div>
    </section>
  )
}
