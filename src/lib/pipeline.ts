// Shared pipeline-stage metadata for every surface that displays or selects a stage:
// the per-conversation dropdown (src/components/inbox/ContactPanel.tsx), the CRM contact
// list + its stage filter (src/components/contacts/ContactTable.tsx) and the CRM detail
// page (src/app/(authenticated)/contacts/[id]/page.tsx).
//
// PIPELINE_STAGES is the single source of truth for both the option list and its order;
// STAGE_LABELS is derived from it so a stage can never appear in one and not the other.

export const PIPELINE_STAGES = [
  { value: 'new', label: 'Baru' },
  { value: 'nego', label: 'Negosiasi' },
  { value: 'booked', label: 'Booked' },
  { value: 'lunas', label: 'Lunas' },
  { value: 'selesai', label: 'Selesai' },
] as const

export const STAGE_LABELS: Record<string, string> = Object.fromEntries(
  PIPELINE_STAGES.map((s) => [s.value, s.label]),
)

export const STAGE_VARIANTS: Record<string, 'muted' | 'warning' | 'brand' | 'success'> = {
  new: 'muted',
  nego: 'warning',
  booked: 'brand',
  lunas: 'success',
  selesai: 'success',
}

// Ordinal rank of each stage, in the same order as PIPELINE_STAGES. Used by
// src/lib/booking/client.ts's auto-advance-from-booking-data logic (see
// deriveStageFromBooking) to decide whether a freshly observed booking signal
// (confirmed / fully paid / trip ended) should move the stage forward -- never
// backward over whatever an agent already set it to by hand.
export const PIPELINE_STAGE_RANK: Record<string, number> = Object.fromEntries(
  PIPELINE_STAGES.map((s, i) => [s.value, i]),
)
