import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

export type MessageView = {
  id: string
  direction: 'INBOUND' | 'OUTBOUND'
  content: string | null
  channel: string
  sentBy: string
  deliveryStatus: string
  createdAt: string
  botTrace: unknown
}

export function MessageBubble({ message }: { message: MessageView }) {
  const isOutbound = message.direction === 'OUTBOUND'
  const isFailed = message.deliveryStatus === 'FAILED'

  return (
    <div className={`flex flex-col gap-1 ${isOutbound ? 'items-end' : 'items-start'}`}>
      <div
        className={
          isOutbound
            ? 'max-w-md rounded-lg rounded-tr-none bg-accent px-3.5 py-2.5 ring-1 ring-brand/10'
            : 'max-w-md rounded-lg rounded-tl-none bg-white px-3.5 py-2.5 shadow-sm ring-1 ring-border'
        }
      >
        {message.content}
      </div>
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        {message.sentBy === 'BOT' && <Badge variant="brand">Bot</Badge>}
        {message.sentBy === 'AGENT' && <span>Agen</span>}
        <Badge variant={isFailed ? 'destructive' : 'muted'}>{message.deliveryStatus}</Badge>
        {isFailed && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="Kirim ulang"
            className="h-auto px-0 text-brand hover:bg-transparent hover:underline"
          >
            Kirim Ulang
          </Button>
        )}
      </div>
    </div>
  )
}
