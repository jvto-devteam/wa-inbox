import type { Platform } from '@prisma/client'
import { isHandoffLogMessage, HANDOFF_LOG_SUMMARY } from '@/lib/message-display'
import { STAGE_LABELS } from '@/lib/pipeline'
import { contactDisplayName } from '@/lib/booking/display-name'
import { PLATFORM_LABEL } from '@/lib/channel/platform'

type Css = React.CSSProperties & Record<`--${string}`, string>

// Warna label baris (kelas .lb-* di new.css, desain artifact). Asal booking yang tidak dikenal (mis. TWT) memakai
// warna netral .lb tanpa kelas tambahan.
const ORDER_CHANNEL_CLASS: Record<string, string> = { JVTO: 'lb-jvto', KLOOK: 'lb-klook' }
const PLATFORM_COLOR: Record<string, string> = {
  WHATSAPP: 'var(--ch-wa)',
  INSTAGRAM: 'var(--ch-ig)',
  FACEBOOK: 'var(--ch-wa)',
  EMAIL: 'var(--ch-mail)',
}

// Siapa yang bicara terakhir, di depan cuplikan. Pelanggan tidak diberi awalan: dialah
// suara bawaan sebuah inbox, dan menuliskannya di setiap baris hanya menambah tinta.
const PREVIEW_PREFIX: Record<string, string> = { BOT: 'Bot:', AGENT: 'Agen:' }

export type ConversationSummary = {
  id: string
  contactName: string | null
  contactPhone: string
  avatarUrl: string | null
  lastMessage: string | null
  lastMessageSentBy: string | null
  lastMessageAt: string
  botEnabled: boolean
  status: string
  // Sorts this conversation to the top of the list (see GET /api/conversations' orderBy) --
  // currently only ever true for the one isTest sandbox conversation.
  isPinned: boolean
  // Which messaging platform this conversation itself is on -- WhatsApp/Facebook/... -- null
  // when the conversation has no channelIdentity (channelIdentityId is nullable in the
  // schema). NOT the same fact as orderChannel below: this is where the conversation is
  // happening, orderChannel is where a booking originated. Both can show at once.
  platform: Platform | null
  // Hanya untuk EMAIL. Opsional supaya pemanggil lama dan fixture test tetap berlaku.
  subject?: string | null
  // Which platform a booking (if any) originated from -- Klook, JVTO, TWT, etc. Null until
  // there's an actual booking on file, in which case no badge shows at all (see below).
  orderChannel: string | null
  // Where this contact currently sits in the sales pipeline (src/lib/pipeline.ts) -- always
  // present (defaults to "new" in the schema), so its badge always renders, unlike orderChannel.
  pipelineStage: string
  unreadCount: number
  // CHANGE/TASK OPEN untuk booking percakapan ini. Opsional supaya pemanggil lama tetap berlaku.
  openChangeRequests?: number
  labels: Array<{ id: string; name: string; color: string }>
  // Nama tamu dari data booking (bookingData.guest) -- null sampai ada booking pada
  // percakapan ini. Ditampilkan di samping nama kontak lewat contactDisplayName.
  bookingGuestName: string | null
}

/**
 * Waktu di baris daftar dibaca sekilas, bukan dibaca teliti -- yang dicari operator adalah
 * "barusan / tadi / kemarin / lama", bukan tanggal presisi. Jadi: jam untuk hari ini,
 * "Kemarin", nama hari untuk minggu ini, tanggal pendek setelah itu. Semua muat di lebar
 * yang sama sehingga kolom kanan tidak bergoyang dari baris ke baris.
 *
 * `now` bisa disuntik supaya test tidak bergantung pada jam mesin yang menjalankannya.
 */
export function formatListTime(iso: string, now: Date = new Date()): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
  }
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (date.toDateString() === yesterday.toDateString()) return 'Kemarin'
  const daysAgo = (now.getTime() - date.getTime()) / 86_400_000
  if (daysAgo >= 0 && daysAgo < 7) return date.toLocaleDateString('id-ID', { weekday: 'short' })
  return date.toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

/** Dua huruf awal untuk lingkaran avatar: huruf pertama dua kata pertama ("Sarah Lee" -> "SL"). */
export function nameInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

/**
 * Satu baris daftar chat, bentuk desain artifact (.row di new.css): avatar inisial, nama + label, cuplikan pesan
 * terakhir, waktu + jumlah belum dibaca. Label pertama = asal booking (JVTO/KLOOK) bila ada, kalau belum = tahap
 * pipeline; sesudahnya permintaan perubahan yang belum dipenuhi, label operator, dan platform (bila daftar
 * mencampur platform). Isi dan urutan data tidak berubah dari bentuk sebelumnya.
 */
export function ConversationListItem({
  conversation,
  onClick,
  active,
  showPlatformBadge,
}: {
  conversation: ConversationSummary
  onClick: () => void
  active?: boolean
  // False only when a single platform tab (WhatsApp/Facebook) is active -- the one state
  // where every row on screen already agrees on its platform, so the badge would be uniform
  // noise. ConversationList passes this as `filter?.kind !== 'platform'`.
  showPlatformBadge?: boolean
}) {
  // A handoff decision (Task 34) is logged as a Message row with content: null, sentBy: 'BOT' --
  // no real reply was ever sent to the customer. Without this, the sidebar preview renders blank.
  const isHandoffLog = isHandoffLogMessage({
    sentBy: conversation.lastMessageSentBy,
    content: conversation.lastMessage,
  })
  const isUnread = conversation.unreadCount > 0
  const prefix = isHandoffLog ? null : PREVIEW_PREFIX[conversation.lastMessageSentBy ?? '']
  const rawPreview = isHandoffLog ? HANDOFF_LOG_SUMMARY : conversation.lastMessage
  // Email: subjek lebih bermakna daripada kalimat pertama balasan ("Terima kasih, ...").
  const isEmail = conversation.platform === 'EMAIL'
  const preview = isEmail && conversation.subject ? `${conversation.subject} — ${rawPreview ?? ''}` : rawPreview
  const name = contactDisplayName(conversation.contactName, conversation.bookingGuestName, conversation.contactPhone)

  return (
    <button
      type="button"
      onClick={onClick}
      // aria-current, bukan sekadar warna latar: percakapan yang sedang dibuka adalah
      // "halaman" saat ini di dalam daftar ini, dan pembaca layar tidak melihat tint biru.
      aria-current={active ? 'true' : undefined}
      className={'row' + (active ? ' on' : '')}
    >
      <div className="av" aria-hidden="true">{nameInitials(conversation.contactName || name)}</div>
      <div style={{ minWidth: 0 }}>
        <b style={{ flexWrap: 'wrap' }}>
          {conversation.isPinned && <span aria-label="Disematkan" title="Disematkan">📌</span>}
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
          {conversation.orderChannel ? (
            <span className={'lb ' + (ORDER_CHANNEL_CLASS[conversation.orderChannel] ?? '')}>{conversation.orderChannel}</span>
          ) : (
            <span className={'lb' + (conversation.pipelineStage === 'new' ? ' lb-new' : '')}>
              {STAGE_LABELS[conversation.pipelineStage] ?? conversation.pipelineStage}
            </span>
          )}
          {(conversation.openChangeRequests ?? 0) > 0 && (
            <span className="lb" style={{ '--c': 'var(--warn)' } as Css} title="Permintaan perubahan · belum dipenuhi">Perubahan</span>
          )}
          {conversation.labels.map((l) => (
            <span key={l.id} className="lb" style={{ '--c': l.color } as Css}>{l.name}</span>
          ))}
          {showPlatformBadge && conversation.platform && (
            <span className="lb" style={{ '--c': PLATFORM_COLOR[conversation.platform] ?? 'var(--muted)' } as Css}>
              {PLATFORM_LABEL[conversation.platform]}
            </span>
          )}
        </b>
        <p style={isUnread ? { color: 'var(--ink)', fontWeight: 550 } : undefined}>
          {prefix && <>{prefix} </>}
          {preview ?? <i>Belum ada pesan</i>}
        </p>
      </div>
      <div className="t">
        <time dateTime={conversation.lastMessageAt}>{formatListTime(conversation.lastMessageAt)}</time>
        {isUnread && (
          <>
            <br />
            <span className="un" aria-label={`${conversation.unreadCount} pesan belum dibaca`}>
              {conversation.unreadCount > 99 ? '99+' : conversation.unreadCount}
            </span>
          </>
        )}
      </div>
    </button>
  )
}
