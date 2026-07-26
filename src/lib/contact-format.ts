// Pure formatting/inspection helpers shared between the per-conversation ContactPanel
// (src/components/inbox/ContactPanel.tsx) and the global CRM contact detail page
// (src/app/contacts/[id]/page.tsx) — both need to tell apart a verified booking from a
// funnel-only lead and format IDR amounts the same way.

export function hasAnyValue(obj: Record<string, unknown> | null | undefined) {
  return !!obj && Object.values(obj).some((v) => v !== null && v !== undefined && v !== '')
}

export function formatIDR(amount: number) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(amount)
}
