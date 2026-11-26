'use client'
// Susunan halaman Inbox (daftar chat, isi chat + kotak balasan, panel kontak), dipindah apa adanya dari
// halaman /inbox lama supaya susunan Inbox tetap satu dan tidak berubah.
// Satu-satunya parameter: `basePath`, alamat yang ditulis saat operator memilih percakapan.
// Logika membalas, bot, dan antrean tidak ada di sini -- semuanya di komponen anak yang tidak diubah.
import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ConversationList } from '@/components/inbox/ConversationList'
import { ThreadView } from '@/components/inbox/ThreadView'
import { ContactPanel } from '@/components/inbox/ContactPanel'

export interface InboxScreenProps {
  /** Alamat halaman ini; dipakai saat menulis `?conversation=` ke URL. Bawaan `/inbox`. */
  basePath?: string
  /** Dipanggil setiap percakapan terpilih berubah (null = kembali ke daftar). */
  onSelectedChange?: (id: string | null) => void
  /** Tombol info di kepala chat (ponsel): membuka panel kanan sebagai lembar bawah. */
  onInfo?: () => void
}

export function InboxScreen({ basePath = '/inbox', onSelectedChange, onInfo }: InboxScreenProps = {}) {
  // Deep-linked from the Beranda "Perlu perhatian" widget (/inbox?conversation=<id>) -- read
  // once on mount as the initial state rather than synced continuously via an effect, so a user
  // manually picking a different conversation from ConversationList afterward doesn't get
  // stomped back to the URL's original value.
  const router = useRouter()
  const searchParams = useSearchParams()
  const urlConversation = searchParams.get('conversation')
  const urlMessage = searchParams.get('message')
  const [selectedId, setSelectedId] = useState<string | null>(urlConversation)
  // /new memakai ini untuk menyembunyikan bar atas/bawah selagi satu chat terbuka di ponsel. Hanya memberi tahu,
  // tidak mengubah apa pun di Inbox.
  useEffect(() => {
    onSelectedChange?.(selectedId)
  }, [selectedId, onSelectedChange])
  // Dibaca sekali, dengan alasan yang sama seperti `conversation` di atas. Dilepas begitu
  // operator berpindah percakapan: menyorot pesan milik percakapan lain tidak berarti apa-apa.
  const [focusMessageId, setFocusMessageId] = useState<string | null>(urlMessage)
  // `&lihat=1` (butir Ringkasan chat / /summary): pesan hanya disorot, panel "Perbaiki jawaban
  // bot" tidak dibuka sendiri. Tanpa parameter ini (Balas, lonceng gap) perilakunya tetap.
  const urlLihat = searchParams.get('lihat') === '1'
  const [openFixOnFocus, setOpenFixOnFocus] = useState(!urlLihat)
  // `&draft=1` (Balas dari antrean /summary) dan `&followup=1` (Follow up): Inbox menyiapkan
  // balasan -- menyusun draft untuk pesan sorot, atau membuka pemilih template / memfokuskan
  // kotak balasan. Tidak ada yang terkirim; keduanya dilepas saat operator berpindah percakapan.
  const urlDraft = searchParams.get('draft') === '1'
  const urlFollowUp = searchParams.get('followup') === '1'
  const [autoDraft, setAutoDraft] = useState(urlDraft)
  const [followUp, setFollowUp] = useState(urlFollowUp)

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
  const urlKey = `${urlConversation ?? ''}|${urlMessage ?? ''}|${urlLihat ? '1' : ''}|${urlDraft ? '1' : ''}|${urlFollowUp ? '1' : ''}`
  const [lastUrlKey, setLastUrlKey] = useState(urlKey)
  if (urlKey !== lastUrlKey) {
    setLastUrlKey(urlKey)
    // URL tanpa percakapan (mis. operator mengetik /inbox polos) tidak menutup apa pun yang
    // sedang dibaca -- ia hanya bukan permintaan untuk membuka sesuatu.
    if (urlConversation) {
      setSelectedId(urlConversation)
      setFocusMessageId(urlMessage)
      setOpenFixOnFocus(!urlLihat)
      setAutoDraft(urlDraft)
      setFollowUp(urlFollowUp)
    }
  }
  return (
    // Tiga kolom desain artifact (.inbox di new.css): daftar | chat | panel kanan. Urutannya load-bearing: CSS memilih
    // kolom lewat :nth-child (ponsel: daftar ATAU chat; panel kanan jadi lembar bawah; < 1180px panel kanan disembunyikan),
    // jadi ketiga kolom selalu dirender, juga saat belum ada percakapan yang dipilih.
    <div className="inbox">
      <ConversationList
        selectedId={selectedId}
        onSelect={(id) => {
          setSelectedId(id)
          setFocusMessageId(null)
          setAutoDraft(false)
          setFollowUp(false)
          // Pilihan manual ikut ditulis ke URL supaya "apa yang tertulis di URL" dan "apa yang
          // terlihat di layar" tidak pernah berpisah. Tanpa ini, menekan tautan yang SAMA setelah
          // operator berpindah percakapan sendiri tidak melakukan apa-apa: href-nya identik
          // dengan URL lama yang masih tertinggal, jadi tidak ada query yang berubah untuk
          // disinkronkan. `replace`, bukan `push`: berpindah percakapan bukan langkah riwayat.
          //
          // `lastUrlKey` sengaja TIDAK disetel di sini ke URL yang sebentar lagi berlaku.
          // Navigasi itu asinkron: menebaknya lebih dulu membuat URL yang masih tertinggal
          // terbaca sebagai "query berubah" pada render berikutnya, dan penyesuaian di atas
          // justru menarik balik percakapan yang baru saja diklik.
          router.replace(`${basePath}?conversation=${encodeURIComponent(id)}`, { scroll: false })
        }}
      />
      {selectedId ? (
        <>
          {/* Distinct key prefixes, not just `selectedId` on both -- ThreadView and ContactPanel
              are siblings in the same Fragment, and React's key-based reconciliation matches by
              key alone across ALL siblings. Two siblings sharing one key collide in that lookup,
              which left a stale ThreadView DOM node behind whenever selectedId changed. */}
          <ThreadView
            key={`thread-${selectedId}`}
            conversationId={selectedId}
            focusMessageId={focusMessageId ?? undefined}
            openFixOnFocus={openFixOnFocus}
            autoDraft={autoDraft}
            followUp={followUp}
            onBack={() => setSelectedId(null)}
            onInfo={onInfo}
          />
          <ContactPanel key={`contact-${selectedId}`} conversationId={selectedId} />
        </>
      ) : (
        <>
          <div className="col" style={{ display: 'grid', placeItems: 'center', background: 'var(--surface2)' }}>
            <div style={{ textAlign: 'center', maxWidth: 320, padding: 16 }}>
              <b>Pilih percakapan</b>
              <p className="mut sm" style={{ margin: '4px 0 0' }}>
                Buka satu percakapan di daftar kiri untuk membaca riwayatnya dan membalas pelanggan.
              </p>
            </div>
          </div>
          <div className="col" />
        </>
      )}
    </div>
  )
}
