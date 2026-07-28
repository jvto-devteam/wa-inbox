import { Badge } from '@/components/ui/badge'
import { ContactAvatar } from '@/components/ContactAvatar'
import { isHandoffLogMessage, HANDOFF_LOG_TEXT } from '@/lib/message-display'

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
  unreadCount: number
  labels: Array<{ id: string; name: string; color: string }>
}

export function ConversationListItem({
  conversation,
  onClick,
  active,
  killSwitchOn,
}: {
  conversation: ConversationSummary
  onClick: () => void
  active?: boolean
  // Global kill switch overrides every conversation's own botEnabled: while it's on, no bot
  // reply is actually possible here, so the badge must say so even though botEnabled itself
  // is untouched (it's what the bot resumes to once the switch flips back off).
  killSwitchOn?: boolean
}) {
  // A handoff decision (Task 34) is logged as a Message row with content: null, sentBy: 'BOT' --
  // no real reply was ever sent to the customer. Without this, the sidebar preview renders blank.
  const isHandoffLog = isHandoffLogMessage({
    sentBy: conversation.lastMessageSentBy,
    content: conversation.lastMessage,
  })
  const isUnread = conversation.unreadCount > 0
  const botActive = conversation.botEnabled && !killSwitchOn

  return (
    <button
      onClick={onClick}
      className={`flex w-full items-start gap-2.5 border-b border-border p-3 text-left ${active ? 'bg-accent' : 'hover:bg-muted/50'}`}
    >
      <ContactAvatar name={conversation.contactName} avatarUrl={conversation.avatarUrl} size="size-9" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center justify-between">
          <span className={`truncate ${isUnread ? 'font-semibold' : 'font-medium'}`}>
            {conversation.contactName ?? conversation.contactPhone}
          </span>
          <div className="flex shrink-0 items-center gap-1.5">
            <Badge variant={botActive ? 'brand' : 'muted'}>{botActive ? 'Bot' : 'Agen'}</Badge>
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
      </div>
    </button>
  )
}
