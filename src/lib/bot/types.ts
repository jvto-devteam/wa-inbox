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
  // killSwitchEnabledAt is only meaningful (and only ever set) alongside cause: 'kill_switch' --
  // see src/lib/inbound.ts's handoff-log dedup for why it needs it.
  | { mode: 'handoff'; reason: string; cause?: 'kill_switch'; killSwitchEnabledAt?: Date | null }
  | { mode: 'funnel'; reply: string; nextState: string }
  | { mode: 'faq'; draft: string; sourceTopic: string }
  | { mode: 'booking_context'; reply: string }

export type CatalogPackage = {
  packageKey: string
  // Every canonical destination this package visits, lowercase, e.g.
  // ['bromo', 'ijen'] or ['tumpak sewu', 'bromo', 'ijen'].
  //
  // This replaced a single `destination: string`. The real synced release
  // (catalog/package-profiles.json + module-compatibility.json) has NO
  // single-destination package: all 16 are multi-destination overland tours
  // covering 2-6 of the 5 canonical destinations. Collapsing that to one string
  // would mean a customer asking about "ijen" silently fails to match a package
  // whose single chosen destination happens to be "bromo" -- for 13 of the 16
  // packages. Matching (route-gate.ts, funnel.ts) is therefore token-wise:
  // a package matches if ANY of its tokens matches.
  destinationTokens: string[]
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
