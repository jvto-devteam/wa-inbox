// Post-generation verification of the ONE thing this bot cannot afford to get
// wrong: the prices and links it puts in front of a customer.
//
// Until this file existed, the only check applied to a composed reply was that
// it was non-empty. Every "never invent a price or a URL" rule lived inside the
// system prompt (SHARED_PERSONA_INSTRUCTIONS and knowledge.ts's
// GUARDRAIL_INSTRUCTION both say it in as many words) and nothing ever compared
// the reply back against the facts it was supposed to have been grounded in.
// For this bot specifically that is the most expensive gap available: prices are
// per-pax TIERS (see CatalogPackage.priceTiers), so quoting the wrong one is a
// subtle, plausible-looking, and costly error the customer reads as a quote --
// and catalog/customer-link-registry.json shipped 18 broken "existing" URLs once
// already (see knowledge.ts's header), so a link the model half-remembers is a
// real, already-observed failure mode rather than a hypothetical one.
//
// `extractRupiahAmounts` / `parseIndonesianNumber` / `isDerivableAmount` are
// ported from watsapin's lib/bot-engine/price-guard.ts (sibling repo, same
// author, different product), extended here with URL checking.
//
// TWO deliberately different severities, because this bot legitimately does
// arithmetic in an order summary:
//
//   - `fabricatedPrices` -- the grounding for this turn contained NO price at
//     all, yet the reply states one. There is nothing it could have been derived
//     from, so it was invented. Blocked: retried once, then handed off.
//
//   - `unverifiedPrices` -- the grounding DID contain prices, but this figure is
//     neither one of them nor a simple derivation of them. Recorded in the trace
//     and STILL SENT: a real quote sums and multiplies in ways no closed-form
//     check can enumerate, and blocking those would break real quoting to defend
//     against a much rarer failure.
//
//   - `unknownUrls` -- always blocked. Unlike a price, there is no arithmetic
//     that could legitimately produce a URL the grounding never contained.
//
// Task 14 added a fourth, unrelated check that piggybacks on the same "verify what the
// reply actually said" pass: `guaranteeViolations` -- the reply promising something
// (blue_fire/destination_readiness) the guardrail says can never be promised. Same recorded-
// not-blocked severity as `unverifiedPrices`, for the same reason: the failure is rare enough,
// and a false positive expensive enough, that recording beats blocking until Task 15's
// frequency data says otherwise. See `findGuaranteeViolations`'s own header below for why it
// keeps its own phrase list instead of reusing knowledge.ts's `GUARANTEE_PHRASES`.

/**
 * Rp-prefixed, or bare-number-with-an-Indonesian-magnitude-suffix.
 *
 * The `\b` after the suffix group is load-bearing in BOTH branches, not just the
 * bare-number one: without it, "Rp3.500 kalau ambil satu" parsed the "k" of
 * "kalau" as the thousands suffix and reported a price of Rp3.500.000 -- a false
 * positive that would have blocked a perfectly good reply. Observed live in
 * watsapin; there is a test for exactly that string here.
 */
const AMOUNT_PATTERN =
  /(?:(?:rp|idr)\s*\.?\s*(\d[\d.,]*\d|\d)(?:\s*(rb|ribu|jt|juta|k)\b)?)|(?:\b(\d[\d.,]*\d|\d)\s*(rb|ribu|jt|juta|k)\b)/gi

const SUFFIX_MULTIPLIER: Record<string, number> = {
  rb: 1000,
  ribu: 1000,
  k: 1000,
  jt: 1_000_000,
  juta: 1_000_000,
}

/**
 * Indonesian number formatting: "." groups thousands and "," is the decimal mark
 * -- the opposite of en-US. Both are accepted as a thousands separator when every
 * group after the first is exactly 3 digits ("1.500.000" and "1,500,000" are the
 * same number), and otherwise treated as a decimal point ("1,5 juta" = 1500000).
 */
function parseIndonesianNumber(raw: string): number | null {
  const hasDot = raw.includes('.')
  const hasComma = raw.includes(',')

  let normalized = raw
  if (hasDot && hasComma) {
    // Mixed: the LAST separator is the decimal mark, the other groups thousands.
    normalized =
      raw.lastIndexOf(',') > raw.lastIndexOf('.') ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(/,/g, '')
  } else if (hasDot || hasComma) {
    const sep = hasDot ? '.' : ','
    const groups = raw.split(sep)
    const isThousandsGrouping = groups.length > 1 && groups.slice(1).every((g) => /^\d{3}$/.test(g))
    normalized = isThousandsGrouping ? groups.join('') : `${groups[0]}.${groups.slice(1).join('')}`
  }

  const value = Number(normalized)
  return Number.isFinite(value) ? value : null
}

/** Every monetary amount stated in `text`, normalized to plain rupiah. */
export function extractRupiahAmounts(text: string): number[] {
  const out: number[] = []
  for (const match of (text ?? '').matchAll(AMOUNT_PATTERN)) {
    const digits = match[1] ?? match[3]
    const suffix = (match[2] ?? match[4] ?? '').toLowerCase()
    if (!digits) continue
    const base = parseIndonesianNumber(digits)
    if (base === null) continue
    out.push(suffix ? base * SUFFIX_MULTIPLIER[suffix] : base)
  }
  return out
}

// Rupiah is not quoted in fractions in practice, so anything under half a rupiah
// apart is the same figure -- this only absorbs float noise from "1,5 juta"-style
// parsing, never a genuinely different price.
const EPSILON = 0.5

/** How many people/units one quote might plausibly total up for. */
const MAX_QUANTITY = 20

/**
 * Whether `amount` is one of `allowed`, or a straightforward arithmetic
 * combination of them: `k x p` (a per-person tier times the group size) or
 * `k x p + q` (that plus one add-on, e.g. a separate health-screening fee).
 * Deliberately stops there -- a deeper search would start "verifying" nearly any
 * number by coincidence, which is worse than not checking at all.
 */
export function isDerivableAmount(amount: number, allowed: number[]): boolean {
  if (allowed.some((a) => Math.abs(a - amount) < EPSILON)) return true
  for (const p of allowed) {
    if (p <= 0) continue
    for (let k = 1; k <= MAX_QUANTITY; k++) {
      const base = k * p
      if (base > amount + EPSILON) break
      if (Math.abs(base - amount) < EPSILON) return true
      for (const q of allowed) {
        if (Math.abs(base + q - amount) < EPSILON) return true
      }
    }
  }
  return false
}

/**
 * Topics whose guardrail forbids promising anything at all. Outside these, "guaranteed" is an
 * ordinary word -- "your booking is guaranteed once the deposit clears" is not a violation.
 *
 * Stated limit (Ruling R37): Mode 3 (booking context, `runBookingContextMode` in
 * orchestrator.ts) passes a fixed `topic: 'booking_context'` label rather than a real
 * `ResolverTopic` -- it never classifies one -- so this check can never fire for an already-
 * booked customer, no matter what the reply says.
 */
const NO_GUARANTEE_TOPICS = new Set(['blue_fire', 'destination_readiness'])

/**
 * The reply side's OWN promise-phrase list -- deliberately NOT knowledge.ts's
 * `GUARANTEE_PHRASES` (Ruling R49). That list detects a customer DEMANDING a guarantee and is
 * tuned wide for that job ('100%', 'certain'); run against a REPLY it would flag "All tours are
 * 100% PRIVATE" (knowledge.ts's own FAQ first line) and "certain conditions" as violations. A
 * false positive here corrupts the one thing this check exists to measure (how often the
 * guardrail is actually broken), so this file keeps its own narrower, reply-side list: the
 * `guarantee` word root and the one phrase that is unambiguously a promise.
 */
const GUARANTEE_ROOT = /\bguarantee(?:d|s)?\b/gi
const DEFINITELY_OPEN_PHRASE = 'definitely be open'

/**
 * "cannot be guaranteed" / "isn't guaranteed" / "not guaranteed" is COMPLIANCE with the
 * guardrail, not a violation of it. No `g` flag -- tested fresh per sentence below, never
 * `.exec`/`.test`-looped, so there is no `lastIndex` state to worry about.
 */
const NEGATED_PROMISE = /\b(?:not|never|cannot|can't|can not|isn't|aren't|won't|no)\s+(?:be\s+)?(?:always\s+)?guarante/i

/**
 * Every promise phrase found in `replyText` that this turn's topic's guardrail forbids making,
 * evaluated PER SENTENCE rather than across the whole reply -- "Blue fire is guaranteed! Refunds
 * are not guaranteed." must still flag the first sentence; a negation later in the reply must
 * never mask an earlier, real violation.
 *
 * Task 22 (Ruling R101): the check runs when the PRIMARY topic OR ANY of `alsoTopics`
 * (classifyAllTopics, multi-topic-classifier.ts -- what else the message also asked about) is
 * in `NO_GUARANTEE_TOPICS`. A message whose primary topic is 'payment' but that also asks about
 * blue_fire still gets scanned: the reply can promise Blue Fire in a sentence answering the
 * side question, and that promise is exactly what the guardrail forbids regardless of which
 * topic happened to classify as primary.
 */
function findGuaranteeViolations(replyText: string, topic: string | undefined, alsoTopics: readonly string[] = []): string[] {
  const topicNeedsCheck = (topic !== undefined && NO_GUARANTEE_TOPICS.has(topic)) || alsoTopics.some((t) => NO_GUARANTEE_TOPICS.has(t))
  if (!topicNeedsCheck) return []
  const violations: string[] = []
  // Ruling R70: strip URLs before scanning -- GUARANTEE_ROOT's word boundaries match a bare
  // "guarantee" inside a URL path/filename (e.g. "https://x.id/guarantee.html") with no actual
  // promise anywhere in the reply. Scoped to THIS scan only -- extractUrls/unknownUrls below
  // still see the untouched `replyText`.
  const withoutUrls = (replyText ?? '').replace(/https?:\/\/\S+/gi, ' ')
  for (const sentence of withoutUrls.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0)) {
    if (NEGATED_PROMISE.test(sentence)) continue
    for (const match of sentence.matchAll(GUARANTEE_ROOT)) violations.push(match[0].toLowerCase())
    if (sentence.toLowerCase().includes(DEFINITELY_OPEN_PHRASE)) violations.push(DEFINITELY_OPEN_PHRASE)
  }
  return [...new Set(violations)]
}

const URL_PATTERN = /https?:\/\/[^\s<>()"']+/gi

/** Trailing punctuation is sentence formatting, not part of the URL. */
export function extractUrls(text: string): string[] {
  return [...((text ?? '').match(URL_PATTERN) ?? [])].map((u) => u.replace(/[.,;:!?)\]]+$/, ''))
}

export type VerificationResult = {
  /** No price in the grounding at all -- block. */
  fabricatedPrices: number[]
  /** The grounding had prices, this is not one of them and not derivable -- advise. */
  unverifiedPrices: number[]
  /** Not in the link registry or any package link for this turn -- block. */
  unknownUrls: string[]
  /**
   * A reply-side promise phrase (see `findGuaranteeViolations`'s header) on a topic whose
   * guardrail forbids making one -- recorded, never blocked (Ruling R49). Always `[]` when
   * neither `topic` nor any of `alsoTopics` (Task 22, Ruling R101) is in `NO_GUARANTEE_TOPICS`.
   */
  guaranteeViolations: string[]
}

/**
 * What the price/URL check concluded for one turn, in the shape stored on
 * `BotDecisionRun.verification`.
 *
 * That column existed with three readers (the Decision Logs list's `hasVerification`, the trace
 * panel's verification block, and the Test Lab's result panel) and NO writer, so all three were
 * permanently empty. This is the record they were waiting for.
 *
 * `attempts` is 1 for a reply that passed first time and 2 whenever the corrective retry ran —
 * "the bot needed a second go before it stopped inventing prices" is the single most useful
 * thing this column can tell an operator scanning a day of runs.
 */
export type ReplyVerification = {
  status: 'PASSED' | 'PASSED_AFTER_RETRY' | 'BLOCKED'
  attempts: number
  fabricatedPrices: number[]
  unverifiedPrices: number[]
  unknownUrls: string[]
  guaranteeViolations: string[]
}

export function verifyReply(params: {
  replyText: string
  groundedAmounts: number[]
  groundedUrls: string[]
  /**
   * The turn's `ResolverTopic`, when known -- drives the guarantee-violation check only
   * (Ruling R37). Optional and unused by the price/URL checks above it, which is why every
   * pre-existing call kept working without it.
   */
  topic?: string
  /**
   * Task 22 (Ruling R101): every OTHER topic classifyAllTopics found in the same message
   * (`ResolverTopic[]` minus the primary one -- see orchestrator.ts's `alsoTopics`). Read only
   * by the guarantee-violation check, same as `topic` above -- optional and defaulted to `[]`
   * in `findGuaranteeViolations`, so every pre-existing call keeps working unchanged.
   */
  alsoTopics?: string[]
}): VerificationResult {
  const { replyText, groundedAmounts, groundedUrls, topic, alsoTopics } = params
  const fabricatedPrices: number[] = []
  const unverifiedPrices: number[] = []
  for (const amount of extractRupiahAmounts(replyText)) {
    if (isDerivableAmount(amount, groundedAmounts)) continue
    if (groundedAmounts.length === 0) fabricatedPrices.push(amount)
    else unverifiedPrices.push(amount)
  }
  // A URL is all-or-nothing: unlike a price there is no arithmetic that could
  // legitimately produce one the grounding never contained, so an unknown URL
  // is always a fabrication. Compared without a trailing slash -- the model
  // routinely adds one and that is formatting, not a different page.
  const allowed = new Set(groundedUrls.map((u) => u.replace(/\/+$/, '')))
  const unknownUrls = [...new Set(extractUrls(replyText).filter((u) => !allowed.has(u.replace(/\/+$/, ''))))]
  return {
    fabricatedPrices: [...new Set(fabricatedPrices)],
    unverifiedPrices: [...new Set(unverifiedPrices)],
    unknownUrls,
    guaranteeViolations: findGuaranteeViolations(replyText, topic, alsoTopics),
  }
}

// No replacement reply constant lives here: a twice-failed verification returns
// `mode: 'handoff'`, and inbound.ts already owns the single honest handoff
// acknowledgment every handoff sends. A second near-identical string here would
// be one more place for that wording to drift.
/**
 * Appended to the system prompt for the ONE corrective retry. Names only the
 * BLOCKING findings -- a merely-unverified figure is legitimate arithmetic that
 * is still sent, so telling the model it fabricated one would train it out of
 * quoting real group totals.
 */
export function buildVerificationRetryInstruction(result: VerificationResult): string {
  const parts: string[] = []
  if (result.fabricatedPrices.length > 0) {
    parts.push(`prices (${result.fabricatedPrices.map((a) => `Rp${a.toLocaleString('id-ID')}`).join(', ')})`)
  }
  if (result.unknownUrls.length > 0) parts.push(`links (${result.unknownUrls.join(', ')})`)
  return (
    `\n\nCRITICAL CORRECTION: your previous reply stated ${parts.join(' and ')} that appear NOWHERE in the facts above. ` +
    `They are fabricated and must not be sent. Rewrite your reply using ONLY the prices and links given above; ` +
    `if the facts above do not contain the price or link the customer asked for, say our team will confirm it shortly and give neither.`
  )
}
