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
  | { mode: 'handoff'; reason: string }
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
