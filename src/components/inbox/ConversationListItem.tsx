import { Bot, BotOff, Pin } from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { isHandoffLogMessage, HANDOFF_LOG_SUMMARY } from '@/lib/message-display'
import { STAGE_LABELS, STAGE_VARIANTS } from '@/lib/pipeline'

// Unlisted channels (e.g. TWT) fall back to the Badge component's own default `muted` look
// rather than guessing a color for a platform we haven't been told one for.
const ORDER_CHANNEL_CLASSES: Record<string, string> = {
  JVTO: 'bg-blue-50 text-blue-700',
  KLOOK: 'bg-orange-50 text-orange-700',
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
  // Which platform a booking (if any) originated from -- Klook, JVTO, TWT, etc. Null until
  // there's an actual booking on file, in which case no badge shows at all (see below).
  orderChannel: string | null
  // Where this contact currently sits in the sales pipeline (src/lib/pipeline.ts) -- always
  // present (defaults to "new" in the schema), so its badge always renders, unlike orderChannel.
  pipelineStage: string
  unreadCount: number
  labels: Array<{ id: string; name: string; color: string }>
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

/**
 * Satu baris daftar, BUKAN kartu.
 *
 * Yang berubah dari bentuk sebelumnya, dan alasannya:
 *
 *  - Dipisah garis rambut penuh lebar, tanpa radius dan tanpa bayangan. Kartu ber-radius yang
 *    ditumpuk membuat mata menghitung kotak; daftar membuat mata memindai kolom.
 *  - Hierarki tiga tingkat yang tetap: nama + waktu di atas, cuplikan + belum-dibaca di
 *    tengah, lencana + status bot di bawah. Sebelumnya nama, cuplikan, dan lencana kira-kira
 *    sama beratnya, jadi tidak ada satu pun yang bisa dipindai duluan.
 *  - Avatar netral (lihat `tone` di src/components/ui/avatar.tsx): di daftar rapat, delapan
 *    rona acak di kolom paling kiri melawan penanda belum dibaca tanpa memberi informasi baru.
 *  - Aksen hanya di dua tempat: bilah kiri baris aktif dan lencana belum dibaca. Waktu,
 *    nama, dan cuplikan semuanya netral.
 */
export function ConversationListItem({
  conversation,
  onClick,
  active,
}: {
  conversation: ConversationSummary
  onClick: () => void
  active?: boolean
}) {
  // A handoff decision (Task 34) is logged as a Message row with content: null, sentBy: 'BOT' --
  // no real reply was ever sent to the customer. Without this, the sidebar preview renders blank.
  const isHandoffLog = isHandoffLogMessage({
    sentBy: conversation.lastMessageSentBy,
    content: conversation.lastMessage,
  })
  const isUnread = conversation.unreadCount > 0
  const prefix = isHandoffLog ? null : PREVIEW_PREFIX[conversation.lastMessageSentBy ?? '']
  const preview = isHandoffLog ? HANDOFF_LOG_SUMMARY : conversation.lastMessage
  const BotIcon = conversation.botEnabled ? Bot : BotOff

  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        // aria-current, bukan sekadar warna latar: percakapan yang sedang dibuka adalah
        // "halaman" saat ini di dalam daftar ini, dan pembaca layar tidak melihat tint biru.
        aria-current={active ? 'true' : undefined}
        className={cn(
          'focus-ring flex w-full gap-2.5 border-b border-l-2 border-b-line py-2.5 pr-3 pl-2 text-left transition-colors',
          active
            ? 'border-l-accent bg-accent-subtle'
            : 'border-l-transparent hover:bg-surface-sunken'
        )}
      >
        <Avatar
          name={conversation.contactName}
          src={conversation.avatarUrl}
          alt={conversation.contactName ?? 'Kontak'}
          maxInitials={1}
          tone="neutral"
          className="mt-0.5 size-9"
        />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex items-baseline gap-2">
            {conversation.isPinned && (
              <span aria-label="Disematkan" title="Disematkan" className="shrink-0 text-ink-subtle">
                <Pin aria-hidden="true" className="size-3.5" strokeWidth={1.75} />
              </span>
            )}
            <span
              className={cn(
                'min-w-0 flex-1 truncate text-base text-ink',
                isUnread ? 'font-semibold' : 'font-medium'
              )}
            >
              {conversation.contactName ?? conversation.contactPhone}
            </span>
            <time dateTime={conversation.lastMessageAt} className="shrink-0 text-xs text-ink-subtle">
              {formatListTime(conversation.lastMessageAt)}
            </time>
          </span>

          <span className="flex items-center gap-2">
            <span
              className={cn(
                'min-w-0 flex-1 truncate text-sm',
                isUnread ? 'font-medium text-ink' : 'text-ink-muted'
              )}
            >
              {prefix && <span className="text-ink-subtle">{prefix} </span>}
              {preview ?? <span className="text-ink-subtle italic">Belum ada pesan</span>}
            </span>
            {isUnread && (
              <span
                aria-label={`${conversation.unreadCount} pesan belum dibaca`}
                className="flex h-4.5 min-w-4.5 shrink-0 items-center justify-center rounded-full bg-accent px-1 text-[10px] leading-none font-semibold text-white tabular-nums"
              >
                {conversation.unreadCount > 99 ? '99+' : conversation.unreadCount}
              </span>
            )}
          </span>

          {/* flex-wrap: order channel + pipeline stage + every label share one row when they
              fit, and drop to a second line instead of overflowing/colliding when they don't.
              Status bot didorong ke ujung kanan baris ini -- satu slot glif yang selalu di
              tempat yang sama, jadi "bot menjawab / bot mati" bisa dipindai menurun tanpa
              membaca satu kata pun. */}
          <span className="flex flex-wrap items-center gap-1">
            {conversation.orderChannel && (
              <Badge variant="muted" className={ORDER_CHANNEL_CLASSES[conversation.orderChannel]}>
                {conversation.orderChannel}
              </Badge>
            )}
            <Badge variant={STAGE_VARIANTS[conversation.pipelineStage] ?? 'muted'}>
              {STAGE_LABELS[conversation.pipelineStage] ?? conversation.pipelineStage}
            </Badge>
            {conversation.labels.map((l) => (
              <Badge key={l.id} style={{ backgroundColor: l.color + '22', color: l.color }}>
                {l.name}
              </Badge>
            ))}
            <span
              aria-label={conversation.botEnabled ? 'Bot aktif' : 'Bot mati'}
              title={conversation.botEnabled ? 'Bot menjawab otomatis' : 'Bot mati — dijawab agen'}
              className="ml-auto shrink-0 pl-1 text-ink-subtle"
            >
              <BotIcon aria-hidden="true" className="size-3.5" strokeWidth={1.75} />
            </span>
          </span>
        </span>
      </button>
    </li>
  )
}
