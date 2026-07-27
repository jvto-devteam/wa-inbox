export type TripBrief = {
  destination?: string
  dateRange?: string
  pax?: number
  notes?: string
  funnelState?: string
}

export type RouteGateResult =
  | { status: 'clear' }
  | { status: 'needs_review'; reason: string }
  | { status: 'handoff'; reason: string }

export type SalesClassification = {
  job: 'J1' | 'J2' | 'J3' | 'J4' | 'J5'
  missingInfo: string[]
  needsLiveData: boolean
}

export type BotDecision =
  // `cause` distinguishes a globally-triggered handoff from a per-conversation one.
  // Callers (src/lib/inbound.ts) need this to decide whether the handoff should also
  // flip Conversation.botEnabled off: a real escalation/gate/error handoff should, the
  // operator kill switch should not -- it is global and temporary, and per-conversation
  // disabling would leave every touched conversation needing manual re-enabling once
  // the switch goes back off. Absent `cause` means an ordinary per-conversation handoff.
  | { mode: 'handoff'; reason: string; cause?: 'kill_switch' }
  | { mode: 'funnel'; reply: string; nextState: string }
  | { mode: 'faq'; draft: string; sourceTopic: string }
  | { mode: 'booking_context'; reply: string }

export type CatalogPackage = {
  packageKey: string
  destination: string
  title: string
  priceIdr: number | null
  inclusions: string[]
  policyNotes: string[]
  links: Record<string, string>
}

export type Catalog = {
  packages: CatalogPackage[]
  syncedAt: string | null
}
