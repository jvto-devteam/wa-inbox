'use client'
import { useState } from 'react'
import type { MessageView } from './MessageBubble'
import { Select } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

type QuickReplyTemplate = { id: string; name: string; category: string; body: string }

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
  const [templates, setTemplates] = useState<QuickReplyTemplate[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)

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

  async function toggleTemplatePicker() {
    if (pickerOpen) {
      setPickerOpen(false)
      return
    }
    const res = await fetch('/api/templates')
    const all = (await res.json()) as Array<{ type: string; id: string; name: string; category: string; body: string }>
    setTemplates(all.filter((t) => t.type === 'QUICK_REPLY'))
    setPickerOpen(true)
  }

  function selectTemplate(body: string) {
    setText(body)
    setPickerOpen(false)
  }

  const templatesByCategory = templates.reduce<Record<string, QuickReplyTemplate[]>>((acc, t) => {
    ;(acc[t.category] ??= []).push(t)
    return acc
  }, {})

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
      {pickerOpen && (
        <Card className="max-h-56 space-y-3 overflow-y-auto p-3">
          {templates.length === 0 ? (
            <p className="text-sm text-muted-foreground">Belum ada template quick reply.</p>
          ) : (
            Object.entries(templatesByCategory).map(([category, items]) => (
              <div key={category} className="space-y-1.5">
                <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {category.toUpperCase()}
                </h4>
                <div className="flex flex-wrap gap-1.5">
                  {items.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => selectTemplate(t.body)}
                      className="badge cursor-pointer bg-secondary text-secondary-foreground hover:bg-slate-200"
                    >
                      {t.name}
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}
        </Card>
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
        <Button type="button" variant="outline" size="sm" onClick={toggleTemplatePicker}>
          Template
        </Button>
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
