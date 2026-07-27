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

  return (
    <button
      onClick={onClick}
      className={`flex w-full flex-col gap-1 border-b border-border p-3 text-left ${active ? 'bg-accent' : 'hover:bg-muted/50'}`}
    >
      <div className="flex items-center justify-between">
        <span className="font-medium">{conversation.contactName ?? conversation.contactPhone}</span>
        <Badge variant={conversation.botEnabled ? 'brand' : 'muted'}>
          {conversation.botEnabled ? 'Bot' : 'Agen'}
        </Badge>
      </div>
      <span className="truncate text-sm text-muted-foreground">
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
