import { Badge } from '@/components/ui/badge'

export type ConversationSummary = {
  id: string
  contactName: string | null
  contactPhone: string
  lastMessage: string | null
  lastMessageAt: string
  unreadCount: number
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
      <span className="truncate text-sm text-muted-foreground">{conversation.lastMessage}</span>
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
