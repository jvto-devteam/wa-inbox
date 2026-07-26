'use client'
import { useState } from 'react'
import type { MessageView } from './MessageBubble'
import { Select } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

export function ComposeBox({
  conversationId,
  onSent,
}: {
  conversationId: string
  onSent: (m: MessageView) => void
}) {
  const [text, setText] = useState('')
  const [channel, setChannel] = useState<'OFFICIAL' | 'UNOFFICIAL'>('OFFICIAL')
  const [sending, setSending] = useState(false)

  async function send() {
    if (!text.trim() || sending) return
    setSending(true)
    try {
      const res = await fetch('/api/send', {
        method: 'POST',
        body: JSON.stringify({ conversationId, text, channel }),
      })
      const message = await res.json()
      onSent({
        id: message.id,
        direction: 'OUTBOUND',
        content: text,
        channel,
        sentBy: 'AGENT',
        deliveryStatus: message.deliveryStatus,
        createdAt: new Date().toISOString(),
        botTrace: null,
      })
      setText('')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex items-center gap-2 border-t border-border bg-white p-3">
      <Select
        value={channel}
        onChange={(e) => setChannel(e.target.value as 'OFFICIAL' | 'UNOFFICIAL')}
        className="w-auto"
        aria-label="Channel"
      >
        <option value="OFFICIAL">Official</option>
        <option value="UNOFFICIAL">Unofficial</option>
      </Select>
      <Input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && send()}
        placeholder="Reply on WhatsApp..."
        aria-label="Pesan"
      />
      <Button onClick={send} disabled={sending}>
        Kirim
      </Button>
    </div>
  )
}
