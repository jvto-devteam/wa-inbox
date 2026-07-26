'use client'
import { useState } from 'react'
import { LabelPicker, type LabelOption } from '@/components/inbox/LabelPicker'

// Thin client-side state holder so the server-rendered contacts/[id] detail page can still reuse
// the (already client-side, already-tested) LabelPicker, which needs a parent to own
// `attachedLabels` state and hand it back down after each server-confirmed attach/detach.
export function ContactLabels({
  conversationId,
  allLabels,
  initialLabels,
}: {
  conversationId: string
  allLabels: LabelOption[]
  initialLabels: LabelOption[]
}) {
  const [attachedLabels, setAttachedLabels] = useState<LabelOption[]>(initialLabels)

  return (
    <LabelPicker
      conversationId={conversationId}
      allLabels={allLabels}
      attachedLabels={attachedLabels}
      onAttachedChange={setAttachedLabels}
    />
  )
}
