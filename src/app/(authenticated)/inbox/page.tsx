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
    // h-full, not h-screen: src/app/(authenticated)/layout.tsx now puts a nav bar above every
    // page and owns the viewport height, so a 100vh child here would make the document taller
    // than the screen and scroll the nav bar off the top.
    //
    // grid-rows-[minmax(0,1fr)] is load-bearing, not decoration: a grid's implicit row
    // defaults to `auto` sizing (tallest child's natural content height), so without it a long
    // contact panel or a long message thread grows the row past the viewport and the *outer*
    // layout wrapper (which owns its own overflow-y-auto) ends up scrolling the whole three-pane
    // grid as one unit instead of each pane scrolling internally. minmax(0, 1fr) pins the row to
    // exactly the container's height and lets it shrink, so each pane's own h-full/overflow-y-auto
    // (see ConversationList/ThreadView/ContactPanel, each also needing min-h-0 for the same reason
    // grid/flex items refuse to shrink below their content by default) does the actual scrolling.
    //
    // The middle column needs the exact same minmax(0, ...) treatment, not just `1fr`: a track's
    // implicit minimum defaults to `auto` (the min-content size of what's inside it), so one long
    // unbreakable string anywhere in the thread -- a quoted reply preview, a URL, a long word --
    // grows the whole column (and the grid) past the viewport instead of letting ThreadView's own
    // truncate/wrap/overflow handling engage.
    <div className="grid h-full grid-cols-[20rem_minmax(0,1fr)_20rem] grid-rows-[minmax(0,1fr)]">
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
    <Suspense fallback={<div className="flex h-full items-center justify-center text-muted-foreground">Memuat...</div>}>
      <InboxPageContent />
    </Suspense>
  )
}
