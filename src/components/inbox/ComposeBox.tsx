'use client'
import { useState } from 'react'
import type { MessageView } from './MessageBubble'
import { Select } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

export function ComposeBox({
  conversationId,
  botEnabled,
  onSent,
  onBotToggled,
}: {
  conversationId: string
  botEnabled: boolean
  onSent: (m: MessageView) => void
  onBotToggled: (enabled: boolean) => void
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

  async function toggleBot() {
    const res = await fetch(`/api/conversations/${conversationId}/toggle-bot`, { method: 'POST' })
    const { botEnabled: newValue } = await res.json()
    onBotToggled(newValue)
  }

  return (
    <div className="flex flex-col gap-2 border-t border-border bg-white p-3">
      {botEnabled && (
        <button
          type="button"
          onClick={toggleBot}
          className="badge self-start cursor-pointer bg-amber-50 text-amber-700"
        >
          Ambil Alih dari Bot
        </button>
      )}
      <div className="flex items-center gap-2">
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
    </div>
  )
}
