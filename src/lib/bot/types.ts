export type TripBrief = {
  destination?: string
  dateRange?: string
  pax?: number
  notes?: string
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

// One step of the bot's reasoning, in the order it actually happened -- what it checked,
// what it found, why it moved to the next step. Shown to an agent via BotTracePopover
// (clicking the 🧠 icon on a bot reply), so a decision is auditable beyond just the final
// mode/reason. Optional on every BotDecision variant so a botTrace row stored before this
// existed still renders (falls back to the old terse summary).
export type TraceStep = { label: string; detail: string }

export type BotDecision =
  | { mode: 'handoff'; reason: string; steps?: TraceStep[] }
  | { mode: 'faq'; draft: string; sourceTopic: string; steps?: TraceStep[] }
  | { mode: 'booking_context'; reply: string; steps?: TraceStep[] }

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
  // packages. Matching (route-gate.ts, package-match.ts) is therefore
  // token-wise: a package matches if ANY of its tokens matches.
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
