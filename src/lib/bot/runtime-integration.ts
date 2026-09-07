/**
 * Where Bot Control's published configuration actually reaches the bot.
 *
 * Phases C to G built four loaders and wired none of them into the decision path: publishing a
 * rule wrote a row that nothing read. This module is the join, kept as its own file so the
 * change to `orchestrator.ts` — a 1,753-line file whose control flow is the product — stays
 * three small call sites instead of logic spread through it.
 *
 * --- Every function here is safe by omission ---
 *
 * Each one answers "what did the operator publish, if anything" and falls back to what the code
 * did before. A database outage, an un-seeded table, a shape this build cannot read: all of them
 * produce the bot's previous behaviour, never a half-applied configuration. That is the property
 * that makes turning this on at all defensible — the worst case is Phase G's bot, not an
 * unpredictable one.
 */
import { isRuleEnabled } from '@/lib/bot-control/runtime-rules'
import { getFlowText } from '@/lib/bot-control/runtime-flows'
import { EXISTING_BOT_FLOW_KEY } from '@/lib/bot-control/existing-flow-registry'
import { loadPublishedManagedKnowledge, type KnowledgeRef } from '@/lib/bot/managed-knowledge'

/**
 * Whether the LLM escalation layer should run.
 *
 * Only the LLM layer. The explicit keyword gate in `escalation-classifier.ts` runs
 * unconditionally and is not reachable from any form — `rule-registry.ts` says exactly this, and
 * it is the reason `bot.handoff_on_human_request` is editable at all. A customer who types
 * "saya mau bicara dengan manusia" still reaches a human whatever anyone publishes.
 *
 * Defaults to TRUE on any failure: every rule in this system is a restriction on the bot, so an
 * unreadable one must leave the restriction in place.
 */
export async function shouldRunEscalationClassifier(): Promise<boolean> {
  return isRuleEnabled('bot.handoff_on_human_request')
}

/** The published fallback wording, or the caller's own constant. */
export async function fallbackReplyText(codeDefault: string): Promise<string> {
  return getFlowText(EXISTING_BOT_FLOW_KEY, 'fallbackReply', codeDefault)
}

/**
 * The published handoff wording, or the caller's own constant.
 *
 * Replaces `clarificationText`, which was exported here with a docstring and never called by
 * anything: `clarificationPrompt` has no single sentence to override, since clarify replies are
 * composed per branch. `handoffReply` does — inbound.ts says one fixed sentence on every
 * handoff — so this is the one that can honestly exist.
 */
export async function handoffReplyText(codeDefault: string): Promise<string> {
  return getFlowText(EXISTING_BOT_FLOW_KEY, 'handoffReply', codeDefault)
}

export type ManagedFacts = {
  /** Lines to fold into the grounding, in the same shape the catalog produces. */
  lines: string[]
  /** Trace refs, labelled MANAGED so a reader can tell them from catalog facts. */
  refs: KnowledgeRef[]
}

const EMPTY: ManagedFacts = { lines: [], refs: [] }

/**
 * Words too common to carry a topic.
 *
 * The question words matter most and are the reason this list is as long as it is: "berapa"
 * appears in a large share of every Indonesian customer message this bot sees, so leaving it in
 * made a single FAQ about ATV prices match "jam berapa pickup dari bandara?" — and from there,
 * every entry would match nearly every message. Politeness fillers are here for the same reason.
 */
const STOPWORDS = new Set([
  // Question words and fillers, Indonesian.
  'yang', 'untuk', 'dari', 'dengan', 'atau', 'dan', 'ada', 'apa', 'apakah', 'adakah', 'bisa',
  'bisakah', 'boleh', 'saya', 'kami', 'kita', 'anda', 'ini', 'itu', 'berapa', 'kapan', 'dimana',
  'mana', 'bagaimana', 'gimana', 'kenapa', 'mengapa', 'siapa', 'mohon', 'tolong', 'terima',
  'kasih', 'selamat', 'halo', 'hallo', 'sudah', 'belum', 'akan', 'juga', 'saja', 'kalau', 'jika',
  'tapi', 'tetapi', 'karena', 'tersebut', 'tentang', 'seperti', 'punya', 'ingin', 'pengen',
  // English.
  'the', 'and', 'for', 'with', 'you', 'are', 'what', 'can', 'how', 'where', 'when', 'does',
  'have', 'this', 'that', 'there', 'would', 'could', 'should', 'please', 'thanks', 'hello',
  'about', 'from', 'your', 'much', 'many',
])

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length >= 4 && !STOPWORDS.has(word))
  )
}

/**
 * Managed knowledge relevant to one customer message.
 *
 * Matched rather than dumped. Folding EVERY published entry into every prompt would bury the
 * catalog facts the answer actually needs under unrelated ones, and the reply verifier would
 * then have more sourceable prices and URLs than the question ever called for — which is the
 * opposite of what `bot.no_invented_price` is protecting.
 *
 * The match is deliberately crude: a shared word of four letters or more between the customer's
 * message and the entry's question or tags. Something more clever (embeddings, an LLM judge)
 * would be another model call inside a turn that already spends its budget on several, and
 * would fail in ways nobody could read from a trace.
 */
export async function managedFactsFor(message: string): Promise<ManagedFacts> {
  let managed
  try {
    managed = await loadPublishedManagedKnowledge()
  } catch (error) {
    // The loader already fails open; this is belt-and-braces because the caller is a bot turn.
    console.error('managedFactsFor: gagal memuat knowledge terkelola', { error })
    return EMPTY
  }
  if (managed.entries.length === 0) return EMPTY

  const asked = tokens(message)
  if (asked.size === 0) return EMPTY

  const lines: string[] = []
  const refs: KnowledgeRef[] = []

  for (const entry of managed.entries) {
    const matched = entry.items.filter((item) => {
      const candidate = tokens(`${item.question} ${(item.tags ?? []).join(' ')}`)
      for (const word of candidate) if (asked.has(word)) return true
      return false
    })
    if (matched.length === 0) continue

    for (const item of matched) {
      lines.push(`${item.question} — ${item.answer}`)
      // Prices and links travel as their own lines so the reply verifier can source them: a
      // figure buried in prose is indistinguishable, to it, from one the model invented.
      for (const price of item.prices ?? []) {
        lines.push(`${price.label}: ${price.currency} ${price.amount}${price.note ? ` (${price.note})` : ''}`)
      }
      for (const link of item.links ?? []) lines.push(`${link.label}: ${link.url}`)
    }

    refs.push({
      sourceType: 'MANAGED',
      sourceKey: entry.sourceKey,
      title: entry.sourceTitle,
      version: entry.version,
    })
  }

  return { lines, refs }
}
