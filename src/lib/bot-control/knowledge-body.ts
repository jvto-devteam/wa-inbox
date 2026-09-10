/**
 * The shape of managed knowledge, and the only thing allowed into `KnowledgeRevision.body`.
 *
 * --- Why this is validated rather than left as free-form Json ---
 *
 * The body is read by the BOT, not just rendered by a page. An item missing its `answer`, or
 * carrying a number where a string belongs, does not produce a broken layout — it produces a
 * bot that answers a customer with `undefined`, or throws inside a turn and hands off. A Json
 * column with no schema puts that one operator typo away.
 *
 * --- Why prices and links are structured, not prose ---
 *
 * `bot.no_invented_price` and `bot.no_invented_url` are CRITICAL, non-editable rules: the bot
 * may only state a price or a URL it can source. Managed knowledge is a new source, so the
 * things it can source have to be machine-readable — a price buried in a sentence is
 * indistinguishable from one the model made up, and the verifier cannot tell them apart.
 */
import { z } from 'zod'
import { RESOLVER_TOPICS, type ResolverTopic } from '@/lib/bot/module-resolver'

/** A price the bot is permitted to quote, with the currency stated rather than assumed. */
export const knowledgePriceSchema = z
  .object({
    label: z.string().trim().min(1).max(200),
    amount: z.number().finite().nonnegative(),
    currency: z.string().trim().min(1).max(10),
    note: z.string().trim().max(500).optional(),
  })
  .strict()

export const knowledgeLinkSchema = z
  .object({
    label: z.string().trim().min(1).max(200),
    // http(s) only: a `javascript:` or `data:` URL reaching a customer's WhatsApp is a
    // phishing vector wearing this feature as a costume.
    url: z.string().trim().url().refine((value) => /^https?:\/\//i.test(value), {
      message: 'URL harus http atau https',
    }),
  })
  .strict()

export const knowledgeItemSchema = z
  .object({
    question: z.string().trim().min(1).max(1000),
    answer: z.string().trim().min(1).max(5000),
    tags: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
    /**
     * Topik yang DILAYANI fakta ini — gerbang relevansi di runtime-integration.ts.
     *
     * OPSIONAL dengan sengaja: item tanpa `topics` berperilaku persis seperti sebelum
     * field ini ada (overlap token), sehingga nol revisi PUBLISHED yang sudah terbit
     * menjadi tidak terbaca. Jangan pernah menjadikannya wajib tanpa backfill terverifikasi.
     *
     * Boleh LEBIH DARI SATU: satu fakta sering melayani beberapa jenis pertanyaan
     * (drop-off Malang yang memuat surcharge melayani route_endpoint DAN price).
     */
    topics: z.array(z.enum(RESOLVER_TOPICS)).max(14).optional(),
    links: z.array(knowledgeLinkSchema).max(20).optional(),
    prices: z.array(knowledgePriceSchema).max(50).optional(),
  })
  .strict()

/**
 * At least one item. An empty knowledge source is not knowledge — publishing one would put a
 * row in the explorer claiming the bot knows something, backed by nothing.
 */
export const knowledgeBodySchema = z.object({ items: z.array(knowledgeItemSchema).min(1).max(200) }).strict()

export type KnowledgeLink = z.infer<typeof knowledgeLinkSchema>
export type KnowledgePrice = z.infer<typeof knowledgePriceSchema>
export type KnowledgeItem = z.infer<typeof knowledgeItemSchema>
export type ManagedKnowledgeBody = z.infer<typeof knowledgeBodySchema>

export type BodyValidation =
  | { ok: true; body: ManagedKnowledgeBody }
  | { ok: false; error: string }

/** Validates a proposed body, naming the field at fault rather than dumping Zod's tree. */
export function validateKnowledgeBody(value: unknown): BodyValidation {
  const parsed = knowledgeBodySchema.safeParse(value)
  if (parsed.success) return { ok: true, body: parsed.data }

  const fields = parsed.error.issues.flatMap((issue) =>
    issue.code === 'unrecognized_keys' ? issue.keys : [issue.path.join('.') || '(isi)']
  )
  return { ok: false, error: `Isi knowledge tidak valid pada: ${[...new Set(fields)].join(', ')}.` }
}

/**
 * Reads a stored body back, defensively.
 *
 * A row written by an older build, or edited straight in the database, may not match this
 * schema. Returning null lets the caller skip it rather than hand the bot a shape it will
 * dereference blindly mid-conversation.
 */
export function readKnowledgeBody(value: unknown): ManagedKnowledgeBody | null {
  const parsed = knowledgeBodySchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

/**
 * The union of every item's `topics` in a body, ordered by `RESOLVER_TOPICS` rather than by
 * write order. Callers (the sources and revisions GET routes) surface this as a badge so a
 * classifier misfire — the risk Task 8 introduced — is visible on the list, not only inside
 * the editor.
 *
 * `[]` for a body this build cannot read (via `readKnowledgeBody`), same as any other reader of
 * a stored body: skip it rather than dereference a shape that might not have `items` at all.
 */
export function topicsOfBody(value: unknown): ResolverTopic[] {
  const body = readKnowledgeBody(value)
  if (!body) return []
  const found = new Set<ResolverTopic>()
  for (const item of body.items) {
    for (const topic of item.topics ?? []) found.add(topic)
  }
  return RESOLVER_TOPICS.filter((topic) => found.has(topic))
}
