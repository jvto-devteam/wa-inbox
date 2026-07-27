import { Badge } from '@/components/ui/badge'
import { isHandoffLogMessage, HANDOFF_LOG_TEXT } from '@/lib/message-display'

export type ConversationSummary = {
  id: string
  contactName: string | null
  contactPhone: string
  lastMessage: string | null
  lastMessageSentBy: string | null
  lastMessageAt: string
  botEnabled: boolean
  status: string
  unreadCount: number
  labels: Array<{ id: string; name: string; color: string }>
}

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

  return (
    <button
      onClick={onClick}
      className={`flex w-full flex-col gap-1 border-b border-border p-3 text-left ${active ? 'bg-accent' : 'hover:bg-muted/50'}`}
    >
      <div className="flex items-center justify-between">
        <span className={isUnread ? 'font-semibold' : 'font-medium'}>
          {conversation.contactName ?? conversation.contactPhone}
        </span>
        <div className="flex items-center gap-1.5">
          <Badge variant={conversation.botEnabled ? 'brand' : 'muted'}>
            {conversation.botEnabled ? 'Bot' : 'Agen'}
          </Badge>
          {isUnread && (
            <span
              aria-label={`${conversation.unreadCount} pesan belum dibaca`}
              className="flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1.5 text-[11px] font-semibold text-white"
            >
              {conversation.unreadCount > 99 ? '99+' : conversation.unreadCount}
            </span>
          )}
        </div>
      </div>
      <span className={`truncate text-sm ${isUnread ? 'font-medium text-foreground' : 'text-muted-foreground'}`}>
        {isHandoffLog ? HANDOFF_LOG_TEXT : conversation.lastMessage}
      </span>
      <div className="flex gap-1">
        {conversation.labels.map((l) => (
          <Badge key={l.id} style={{ backgroundColor: l.color + '22', color: l.color }}>
            {l.name}
          </Badge>
        ))}
      </div>
    </button>
  )
}
