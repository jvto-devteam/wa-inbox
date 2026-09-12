'use client'
import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { MessagesSquare } from 'lucide-react'
import { ConversationList } from '@/components/inbox/ConversationList'
import { ThreadView } from '@/components/inbox/ThreadView'
import { ContactPanel } from '@/components/inbox/ContactPanel'
import { EmptyState } from '@/components/ui/empty-state'
import { cn } from '@/lib/utils'

function InboxPageContent() {
  // Deep-linked from the Beranda "Perlu perhatian" widget (/inbox?conversation=<id>) -- read
  // once on mount as the initial state rather than synced continuously via an effect, so a user
  // manually picking a different conversation from ConversationList afterward doesn't get
  // stomped back to the URL's original value.
  const router = useRouter()
  const searchParams = useSearchParams()
  const urlConversation = searchParams.get('conversation')
  const urlMessage = searchParams.get('message')
  const [selectedId, setSelectedId] = useState<string | null>(urlConversation)
  // Dibaca sekali, dengan alasan yang sama seperti `conversation` di atas. Dilepas begitu
  // operator berpindah percakapan: menyorot pesan milik percakapan lain tidak berarti apa-apa.
  const [focusMessageId, setFocusMessageId] = useState<string | null>(urlMessage)

  // Lonceng gap ada di SETIAP halaman, /inbox termasuk. Menekan salah satu isinya dari /inbox
  // adalah navigasi ke rute yang sama dengan query berbeda, dan React mempertahankan komponen
  // yang sudah terpasang -- inisialisasi useState di atas tidak dijalankan ulang, jadi URL-nya
  // berubah sementara layarnya tidak. Itulah "diklik, tidak terjadi apa-apa" yang dilaporkan.
  //
  // Yang memicu sinkronisasi adalah query yang BERUBAH, bukan query yang ada: membaca URL pada
  // setiap render akan menarik balik percakapan yang baru saja dipilih operator sendiri, persis
  // yang dihindari oleh useState-sekali-baca semula.
  //
  // Penyesuaiannya di fase render, bukan di useEffect: ini pola "menyesuaikan state saat prop
  // berubah" milik React, dan React membuang render yang sedang berjalan lalu mengulangnya
  // dengan nilai baru SEBELUM apa pun tergambar. Versi useEffect-nya menggambar satu bingkai
  // dengan percakapan lama dulu, dan ditolak lint di repo ini (cascading renders).
  const urlKey = `${urlConversation ?? ''}|${urlMessage ?? ''}`
  const [lastUrlKey, setLastUrlKey] = useState(urlKey)
  if (urlKey !== lastUrlKey) {
    setLastUrlKey(urlKey)
    // URL tanpa percakapan (mis. operator mengetik /inbox polos) tidak menutup apa pun yang
    // sedang dibaca -- ia hanya bukan permintaan untuk membuka sesuatu.
    if (urlConversation) {
      setSelectedId(urlConversation)
      setFocusMessageId(urlMessage)
    }
  }
  // Hanya berlaku dari xl ke atas -- lihat komentar geometri di bawah. Di bawah xl panel kontak
  // memang tidak punya kolom, jadi tombolnya pun tidak dirender di sana (ThreadView).
  const [contactPanelOpen, setContactPanelOpen] = useState(true)

  return (
    // GEOMETRI TIGA KOLOM (load-bearing, bukan dekorasi)
    //
    // h-full, bukan h-screen: src/app/(authenticated)/layout.tsx memiliki tinggi viewport dan
    // menaruh rail di sebelahnya, jadi anak setinggi 100vh di sini akan mengabaikan rail dan
    // membuat dokumen lebih tinggi dari layar.
    //
    // grid-rows-[minmax(0,1fr)] wajib: baris implisit sebuah grid default-nya `auto` (setinggi
    // anak tertingginya), jadi tanpa ini thread yang panjang menumbuhkan barisnya melewati
    // viewport dan pembungkus layout luar (yang memegang overflow-y-auto sendiri) menggulung
    // SELURUH grid sebagai satu blok -- gulungan ganda yang persis dilarang. minmax(0,1fr)
    // memakukan baris ke tinggi kontainer dan membiarkannya menyusut, sehingga h-full +
    // overflow-y-auto milik tiap kolom yang benar-benar menggulung.
    //
    // Kolom tengah juga minmax(0,1fr), bukan 1fr: minimum implisit sebuah track adalah
    // `auto` (min-content isinya), jadi satu untai tanpa spasi di dalam thread -- URL, kutipan
    // balasan, satu kata panjang -- akan melebarkan kolom (dan grid) melewati layar alih-alih
    // membiarkan truncate/wrap milik ThreadView bekerja.
    //
    // TIGA BENTUK, SATU SUSUNAN DOM:
    //   < md  : satu kolom bertingkat. Daftar mengisi layar; begitu sebuah percakapan dipilih
    //           daftar ber-`display:none` (jadi bukan item grid lagi) dan thread mengambil satu-
    //           satunya sel. Tombol kembali di kepala thread yang mengembalikannya.
    //   md-xl : dua kolom. Panel kontak menyembunyikan diri -- 300px ketiga tidak muat tanpa
    //           memeras thread di bawah lebar baca yang wajar.
    //   >= xl : tiga kolom, dan panel kontak bisa ditutup operator (lalu thread melebar).
    <div
      className={cn(
        'grid h-full grid-cols-1 grid-rows-[minmax(0,1fr)] overflow-hidden bg-canvas',
        'md:grid-cols-[20rem_minmax(0,1fr)]',
        selectedId && contactPanelOpen && 'xl:grid-cols-[20rem_minmax(0,1fr)_18.75rem]'
      )}
    >
      <ConversationList
        selectedId={selectedId}
        onSelect={(id) => {
          setSelectedId(id)
          setFocusMessageId(null)
          // Pilihan manual ikut ditulis ke URL supaya "apa yang tertulis di URL" dan "apa yang
          // terlihat di layar" tidak pernah berpisah. Tanpa ini, menekan gap yang SAMA setelah
          // operator berpindah percakapan sendiri tidak melakukan apa-apa: href gap itu identik
          // dengan URL lama yang masih tertinggal, jadi tidak ada query yang berubah untuk
          // disinkronkan. `replace`, bukan `push`: berpindah percakapan bukan langkah riwayat,
          // dan setiap klik di daftar akan menumpuk satu entri tombol-kembali kalau ia jadi.
          //
          // `lastUrlKey` sengaja TIDAK disetel di sini ke URL yang sebentar lagi berlaku.
          // Navigasi itu asinkron: menebaknya lebih dulu membuat URL yang masih tertinggal
          // terbaca sebagai "query berubah" pada render berikutnya, dan penyesuaian di atas
          // justru menarik balik percakapan yang baru saja diklik. Biarkan ia mencatat apa yang
          // BENAR-BENAR terlihat; saat replace mendarat, penyesuaiannya menjadi no-op.
          router.replace(`/inbox?conversation=${encodeURIComponent(id)}`, { scroll: false })
        }}
        className={cn(selectedId && 'max-md:hidden')}
      />
      {selectedId ? (
        <>
          {/* Distinct key prefixes, not just `selectedId` on both -- ThreadView and ContactPanel
              are siblings in the same Fragment, and React's key-based reconciliation matches by
              key alone across ALL siblings in a list regardless of element type. Two siblings
              sharing one key collide in that lookup (the second overwrites the first), which
              left a stale ThreadView DOM node behind whenever selectedId changed -- reproduced by
              the "switch conversations" test in page.test.tsx. */}
          <ThreadView
            key={`thread-${selectedId}`}
            conversationId={selectedId}
            focusMessageId={focusMessageId ?? undefined}
            onBack={() => setSelectedId(null)}
            contactPanelOpen={contactPanelOpen}
            onToggleContactPanel={() => setContactPanelOpen((open) => !open)}
          />
          <ContactPanel
            key={`contact-${selectedId}`}
            conversationId={selectedId}
            className={cn(contactPanelOpen ? 'hidden xl:flex' : 'hidden')}
          />
        </>
      ) : (
        // Tidak dirender di bawah md: di sana daftar percakapan SENDIRI yang mengisi layar, dan
        // "pilih percakapan" di bawah daftar yang sudah terlihat cuma menambah baris kosong.
        <div className="hidden items-center justify-center md:flex">
          <EmptyState
            icon={<MessagesSquare strokeWidth={1.5} />}
            title="Pilih percakapan"
            description="Buka satu percakapan di daftar kiri untuk membaca riwayatnya dan membalas pelanggan."
          />
        </div>
      )}
    </div>
  )
}

export default function InboxPage() {
  // useSearchParams() opts the reading component out of static rendering unless it's wrapped
  // in Suspense (Next.js hard-errors on `next build` otherwise: "should be wrapped in a
  // suspense boundary"). The fallback is effectively invisible in practice -- searchParams
  // resolves synchronously on the client -- but is still a real, non-empty loading state.
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center bg-canvas text-sm text-ink-muted">
          Memuat inbox...
        </div>
      }
    >
      <InboxPageContent />
    </Suspense>
  )
}
