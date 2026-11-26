'use client'

// Inbox /new = Inbox ASLI (src/components/inbox/InboxScreen: daftar chat, isi chat, kotak balasan, panel kontak)
// dengan kulit desain /new. Tidak ada logika di sini: membalas, bot, template, jendela 24 jam, lampiran, dan mode uji
// semuanya milik komponen Inbox yang sama dengan /inbox. Kulitnya hanya CSS (.inbox-real di new.css) yang memetakan
// variabel warna/huruf/sudut Inbox lama ke token /new.
import { Suspense, useCallback } from 'react'
import { InboxScreen } from '@/components/inbox/InboxScreen'
import { LegacyFrame } from '../LegacyFrame'
import { useNew } from '../store'

export function InboxView() {
  const st = useNew()
  const { setChatMode } = st
  // Di ponsel, bar atas dan bar tab bawah /new disembunyikan selagi satu chat terbuka (sama dengan tampilan contoh).
  const onSelectedChange = useCallback((id: string | null) => setChatMode(id ? 'chat' : 'list'), [setChatMode])
  return (
    <section className={'view fx' + (st.mstate === 'chat' ? ' m-chat' : '')} id="v-inbox">
      {/* Tautan di dalam komponen Inbox (mis. /inbox?..., /contacts/...) dibuka di halaman /new padanannya. */}
      <LegacyFrame className="inbox-real">
        <Suspense fallback={<div className="mut" style={{ padding: 16 }}>Memuat inbox…</div>}>
          <InboxScreen basePath="/inbox" onSelectedChange={onSelectedChange} />
        </Suspense>
      </LegacyFrame>
    </section>
  )
}
