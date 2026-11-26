'use client'

// Inbox = tampilan desain artifact (.inbox di new.css: daftar | chat | panel kanan) yang digambar langsung oleh komponen
// Inbox (src/components/inbox/InboxScreen dan anak-anaknya). Tidak ada logika di sini: membalas, bot, template, jendela
// 24 jam, lampiran, mode uji, dan aksi booking semuanya milik komponen Inbox itu sendiri.
import { Suspense, useCallback } from 'react'
import { InboxScreen } from '@/components/inbox/InboxScreen'
import { LegacyFrame } from '../LegacyFrame'
import { useNew } from '../store'

export function InboxView() {
  const st = useNew()
  const { setChatMode, toggleInfo } = st
  // Di ponsel, bar atas dan bar tab bawah disembunyikan selagi satu chat terbuka (sama dengan tampilan contoh).
  const onSelectedChange = useCallback((id: string | null) => setChatMode(id ? 'chat' : 'list'), [setChatMode])
  const onInfo = useCallback(() => toggleInfo(), [toggleInfo])
  return (
    <section className={'view fx' + (st.mstate === 'chat' ? ' m-chat' : '')} id="v-inbox">
      {/* Hanya penjaga tautan (tanpa kulit): tautan lama di dalam bagian Inbox (mis. /bot-control/decisions) dibuka di
          halaman padanannya. */}
      <LegacyFrame skin={false} className="inbox-frame">
        <Suspense fallback={<div className="mut" style={{ padding: 16 }}>Memuat inbox…</div>}>
          <InboxScreen basePath="/inbox" onSelectedChange={onSelectedChange} onInfo={onInfo} />
        </Suspense>
      </LegacyFrame>
      <div className="infoscrim" onClick={() => toggleInfo(false)} />
    </section>
  )
}
