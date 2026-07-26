'use client'
import { useState } from 'react'
import { ConversationList } from '@/components/inbox/ConversationList'

export default function InboxPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null)

  return (
    <div className="grid h-screen grid-cols-[20rem_1fr]">
      <ConversationList selectedId={selectedId} onSelect={setSelectedId} />
      <div className="flex items-center justify-center text-muted-foreground">
        {selectedId ? `Thread ${selectedId} (Task 11)` : 'Pilih percakapan'}
      </div>
    </div>
  )
}
