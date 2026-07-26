// Shared pipeline-stage display metadata for the CRM contact list/detail pages
// (src/components/contacts/ContactTable.tsx, src/app/contacts/[id]/page.tsx). Mirrors the
// stage values used by the editable dropdown in ContactPanel (PIPELINE_STAGES).

export const STAGE_LABELS: Record<string, string> = {
  new: 'Baru',
  nego: 'Negosiasi',
  booked: 'Booked',
  lunas: 'Lunas',
}

export const STAGE_VARIANTS: Record<string, 'muted' | 'warning' | 'brand' | 'success'> = {
  new: 'muted',
  nego: 'warning',
  booked: 'brand',
  lunas: 'success',
}
