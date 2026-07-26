'use client'
import { useState } from 'react'
import { ConversationList } from '@/components/inbox/ConversationList'
import { ThreadView } from '@/components/inbox/ThreadView'
import { ContactPanel } from '@/components/inbox/ContactPanel'

export default function InboxPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null)

  return (
    <div className="grid h-screen grid-cols-[20rem_1fr_20rem]">
      <ConversationList selectedId={selectedId} onSelect={setSelectedId} />
      {selectedId ? (
        <>
          <ThreadView key={selectedId} conversationId={selectedId} />
          <ContactPanel key={selectedId} conversationId={selectedId} />
        </>
      ) : (
        <div className="col-span-2 flex items-center justify-center text-muted-foreground">Pilih percakapan</div>
      )}
    </div>
  )
}
