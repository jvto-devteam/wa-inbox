// Ikon garis dari artifact (stroke mengikuti CSS .nav svg / .mtab svg).
import type { ViewKey } from '@/lib/new/types'

export const NAV_ICON: Record<ViewKey, React.ReactNode> = {
  hub: (<><path d="M3 11l9-7 9 7" /><path d="M5 10v10h14V10" /><path d="M10 20v-6h4v6" /></>),
  inbox: (<><path d="M3 13l3-8h12l3 8v6H3z" /><path d="M3 13h5l1 3h6l1-3h5" /></>),
  antrean: (<><path d="M9 6h11M9 12h11M9 18h11" /><path d="M3.5 6l1 1 2-2M3.5 12l1 1 2-2M3.5 18l1 1 2-2" /></>),
  ringkasan: (<><path d="M6 3h9l4 4v14H6z" /><path d="M14 3v5h5M9 13h7M9 17h7M9 9h2" /></>),
  agent: (<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>),
  kontak: (<><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" /><path d="M16 4.5a3.5 3.5 0 010 7M18 14.5c2 .7 3.5 2.6 3.5 5.5" /></>),
  template: (<><path d="M4 5h16v11H9l-5 4z" /><path d="M8 9h8M8 12.5h5" /></>),
  laporan: (<><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>),
  bot: (<><rect x="4" y="8" width="16" height="11" rx="3" /><path d="M12 8V4M9 13h.01M15 13h.01" /></>),
  kantor: (<><path d="M4 21V5l8-2v18M12 21h8V9l-8-2" /><path d="M7 8h2M7 12h2M7 16h2M15 12h2M15 16h2" /></>),
  pengaturan: (<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" /></>),
}

export function SearchIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  )
}

export function Chevron({ d = 'm6 9 6 6 6-6' }: { d?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}
