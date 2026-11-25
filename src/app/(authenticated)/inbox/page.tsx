'use client'
import { Suspense } from 'react'
import { InboxScreen } from '@/components/inbox/InboxScreen'

export default function InboxPage() {
  // useSearchParams() opts the reading component out of static rendering unless it's wrapped
  // in Suspense (Next.js hard-errors on `next build` otherwise: "should be wrapped in a
  // suspense boundary"). The fallback is effectively invisible in practice -- searchParams
  // resolves synchronously on the client -- but is still a real, non-empty loading state.
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center bg-canvas text-sm text-ink-muted">
          Memuat inbox...
        </div>
      }
    >
      <InboxScreen />
    </Suspense>
  )
}
