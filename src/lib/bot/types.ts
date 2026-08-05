export type TripBrief = {
  destination?: string
  dateRange?: string
  pax?: number
  notes?: string
  // The last real topic (module-resolver.ts's `ResolverTopic` -- all 14, not a narrowed
  // subset) the bot actually answered -- captured for visibility into what a customer was
  // last asking about, mirroring how `destination` already persists across messages. Not
  // currently read back to influence a later decision -- that's a deliberate, separate
  // follow-up, not wired in yet.
  lastTopic?: string
  // The customer's stated starting city ("Bali" | "Surabaya", from package-match.ts's
  // parseTripPreferences) -- persists the same way `destination` does, so "3 day trip from
  // Surabaya" once stated doesn't need repeating on a later message about the same trip.
  origin?: string
  // True once orchestrator.ts has asked a customer where they'd like to start/finish for an
  // origin-ambiguous destination (see orchestrator.ts's TripPreferences clarify branch).
  // Asked AT MOST ONCE per conversation: a customer who never answers the finish-point half
  // still gets a real package recommendation on their next message rather than being asked
  // again -- this flag is what prevents the repeat ask.
  askedTripPreferences?: boolean
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
  | { mode: 'clarify'; reply: string; steps?: TraceStep[] }

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
  // module_applicability's `category: "staging"` modules (module-compatibility.json), joined
  // the exact same way `policyNotes` already is -- which hotel/staging area is used before
  // this package's activities, medical-check timing, ferry pre-booking notes. Added
  // 2026-08-05: 6 real, approved, customer_visible modules with this data existed and were
  // completely unreachable (catalog.ts's join only looked at `category: "policy"`) -- the
  // same class of bug as knowledge.ts's Ijen gas-mask gap, just one level up (package-scoped
  // data, not general-knowledge data).
  stagingNotes: string[]
  links: Record<string, string>
  // package-profiles.json's own `origin` ("Bali" | "Surabaya") and `day_count` --
  // present in the synced data but unused until package-match.ts's duration/origin-aware
  // pickPackage (see that file's header). Title-cased origin, verbatim from the source.
  origin: string | null
  dayCount: number | null
  // endpoint-chains.json's `standard_dropoff_options`, normalized to lowercase single-word
  // city tokens ("bali", "surabaya", "malang", "ketapang") -- which cities this specific
  // package can actually END in. NOT the same as `origin`: a Bali-origin package's real
  // dropoff options are all Surabaya/Malang-area (it does NOT finish in Bali), while some
  // Surabaya-origin packages explicitly can finish in Bali. Added 2026-08-05 after "can we
  // finish the trip in Bali?" got answered from a Bali-ORIGIN package (matching "bali" as a
  // starting-city keyword) instead of checking which packages can actually END there.
  finishCities: string[]
}

export type Catalog = {
  packages: CatalogPackage[]
  syncedAt: string | null
}
