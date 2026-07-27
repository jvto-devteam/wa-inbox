'use client'
import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { ConversationList } from '@/components/inbox/ConversationList'
import { ThreadView } from '@/components/inbox/ThreadView'
import { ContactPanel } from '@/components/inbox/ContactPanel'

function InboxPageContent() {
  // Deep-linked from the Beranda "Perlu perhatian" widget (/inbox?conversation=<id>) -- read
  // once on mount as the initial state rather than synced continuously via an effect, so a user
  // manually picking a different conversation from ConversationList afterward doesn't get
  // stomped back to the URL's original value.
  const searchParams = useSearchParams()
  const [selectedId, setSelectedId] = useState<string | null>(() => searchParams.get('conversation'))

  return (
    <div className="grid h-screen grid-cols-[20rem_1fr_20rem]">
      <ConversationList selectedId={selectedId} onSelect={setSelectedId} />
      {selectedId ? (
        <>
          {/* Distinct key prefixes, not just `selectedId` on both -- ThreadView and ContactPanel
              are siblings in the same Fragment, and React's key-based reconciliation matches by
              key alone across ALL siblings in a list regardless of element type. Two siblings
              sharing one key collide in that lookup (the second overwrites the first), which
              left a stale ThreadView DOM node behind whenever selectedId changed -- reproduced by
              the "switch conversations" test in page.test.tsx. */}
          <ThreadView key={`thread-${selectedId}`} conversationId={selectedId} />
          <ContactPanel key={`contact-${selectedId}`} conversationId={selectedId} />
        </>
      ) : (
        <div className="col-span-2 flex items-center justify-center text-muted-foreground">Pilih percakapan</div>
      )}
    </div>
  )
}

export default function InboxPage() {
  // useSearchParams() opts the reading component out of static rendering unless it's wrapped
  // in Suspense (Next.js hard-errors on `next build` otherwise: "should be wrapped in a
  // suspense boundary"). The fallback is effectively invisible in practice -- searchParams
  // resolves synchronously on the client -- but is still a real, non-empty loading state.
  return (
    <Suspense fallback={<div className="flex h-screen items-center justify-center text-muted-foreground">Memuat...</div>}>
      <InboxPageContent />
    </Suspense>
  )
}
