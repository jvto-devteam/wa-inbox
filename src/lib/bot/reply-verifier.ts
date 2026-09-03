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
}

export function verifyReply(params: { replyText: string; groundedAmounts: number[]; groundedUrls: string[] }): VerificationResult {
  const { replyText, groundedAmounts, groundedUrls } = params
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
  return { fabricatedPrices: [...new Set(fabricatedPrices)], unverifiedPrices: [...new Set(unverifiedPrices)], unknownUrls }
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
