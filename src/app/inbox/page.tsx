'use client'
import { useState } from 'react'
import { ConversationList } from '@/components/inbox/ConversationList'
import { ThreadView } from '@/components/inbox/ThreadView'

export default function InboxPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null)

  return (
    <div className="grid h-screen grid-cols-[20rem_1fr]">
      <ConversationList selectedId={selectedId} onSelect={setSelectedId} />
      {selectedId ? (
        <ThreadView conversationId={selectedId} />
      ) : (
        <div className="flex items-center justify-center text-muted-foreground">Pilih percakapan</div>
      )}
    </div>
  )
}
