# wa-inbox Bot Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut the bot's per-message latency from seven sequential LLM calls to three, close four active correctness bugs, reconnect knowledge the catalog already contains but nothing reads, and give the operator a way to measure whether answers actually improve.

**Architecture:** Three phases over one subsystem — the bot brain (`src/lib/bot/*` plus `src/lib/inbound.ts`). Phase 1 is plumbing: no reply text changes, only ordering, safety and cost. Phase 2 changes what facts reach the model and verifies what comes back. Phase 3 adds measurement, then uses it to justify collapsing six classifiers into one. Each phase leaves the bot shippable.

**Tech Stack:** TypeScript, Next.js 16, Prisma 7 + Postgres, Vitest 4, Ollama (local, `gemma4:31b-cloud`).

**Spec:** This plan is its own spec — it derives from the static audit of `src/lib/bot/` performed 2026-09-03 (recorded in the conversation that produced this file) and from patterns already shipped and verified in the sibling `~/Code/watsapin` repo on 2026-09-03 (commit `7c8d350`).

## Global Constraints

- **Never hand off on a content gap.** `orchestrator.ts`'s header records this as a re-affirmed operator directive. The only permitted handoffs remain: escalation keyword/LLM signal, `job === 'J5'`, a closed deployment gate, and `matchTier === 'none'`. Task 10 adds exactly one more (a reply that fails verification twice) and must say so in its own comment.
- **Never fabricate.** No task may introduce a price, URL, hotel name or policy that is not present in `catalog/*.json`.
- **The bot must stay active.** Every failure path returns `mode: 'clarify'` with `TECHNICAL_HICCUP_REPLY`, never `mode: 'handoff'`, unless it is one of the permitted handoffs above.
- **All customer-facing reply text is English.** Trace/`botTrace` detail strings are Indonesian. Follow the file you are editing.
- **Tests:** `npm test` (vitest). The suite must stay green at the end of every task and no existing test may be deleted or skipped to achieve that. Do not assert on a total test COUNT -- it changes as tasks add tests, and the count in any task step is indicative only. `npx tsc --noEmit` and `npx eslint` must both be clean before every commit.
- **Do not run the dev server, a browser, or any script that writes to the production database.** Verification is the automated suite only.
- **Commit per task**, message in the style of the existing history (imperative subject, body explaining *why*), ending with:
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`

## File Structure

**Phase 1**
- Modify `src/lib/inbound.ts` — burst max-wait cap, rate-limit gate, post-LLM re-check.
- Create `src/lib/bot/rate-limiter.ts` — per-conversation sliding window. One responsibility, no imports.
- Modify `src/lib/bot/orchestrator.ts` — atomic `tripBrief` merge, classifier parallelisation.
- Modify `src/lib/bot/catalog.ts` — mtime-keyed `loadCatalog` cache.

**Phase 2**
- Modify `src/lib/bot/knowledge.ts` — reconnect orphaned modules, Ijen-scoped policies, route-leg pairs as arrays.
- Modify `src/lib/bot/types.ts` + `src/lib/bot/catalog.ts` — per-package accommodation/vehicle/crew fields.
- Modify `src/lib/bot/orchestrator.ts` — logistics grounding, `finishCityFact` scoping, verifier wiring.
- Create `src/lib/bot/reply-verifier.ts` — price + URL verification against the grounding actually used.

**Phase 3**
- Modify `prisma/schema.prisma` — `KnowledgeGapLog` model.
- Create `src/app/api/bot/knowledge-gaps/route.ts` + `src/app/(authenticated)/settings/knowledge-gaps/page.tsx`.
- Create `src/lib/bot/eval/fixtures.ts` + `src/lib/bot/eval/run-eval.ts` + `npm run eval` script.
- Create `src/lib/bot/unified-classifier.ts` — one JSON call replacing the Phase 1 parallel batch.

---

# Phase 1 — Latency, cost and safety

No task in this phase changes a single word of any customer-facing reply.

---

### Task 1: Cap the burst debounce

**Why:** `scheduleBotRun` restarts a 5s timer on every new message with no ceiling. A customer who sends a message every 4 seconds is never replied to at all, and `texts` grows unbounded until they stop.

**Files:**
- Modify: `src/lib/inbound.ts` (the `BURST_DEBOUNCE_MS` / `PendingBurst` / `scheduleBotRun` block, ~line 270-310)
- Test: `src/lib/inbound.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `scheduleBotRun(conversation: { id: string; contactName: string | null }, inboundText: string): void` — signature unchanged.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/inbound.test.ts` (match the file's existing `vi.useFakeTimers()` conventions; call `__resetPendingBurstsForTests()` in `beforeEach`):

```ts
it('flushes a never-pausing burst once the max wait elapses', async () => {
  vi.useFakeTimers()
  const conversation = { id: 'conv_burst_cap', contactName: null }
  // A customer typing every 4s keeps resetting the 5s trailing debounce
  // forever. Without a ceiling they are never answered at all.
  scheduleBotRun(conversation, 'satu')
  for (let i = 0; i < 8; i++) {
    await vi.advanceTimersByTimeAsync(4000)
    scheduleBotRun(conversation, `lagi-${i}`)
  }
  await vi.advanceTimersByTimeAsync(4000)
  expect(decideAndRespond).toHaveBeenCalledTimes(1)
  // Every fragment up to the cap is in the one combined decision.
  expect(vi.mocked(decideAndRespond).mock.calls[0][1]).toContain('satu')
  vi.useRealTimers()
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/inbound.test.ts -t 'max wait'`
Expected: FAIL — `decideAndRespond` called 0 times (the timer is still being pushed out).

- [ ] **Step 3: Implement the cap**

In `src/lib/inbound.ts`, below `BURST_DEBOUNCE_MS`:

```ts
// Hard ceiling on how long ONE burst may keep being extended. Without it the
// trailing debounce has no upper bound: a customer sending a message every 4
// seconds resets the timer forever and is never replied to at all, while
// `texts` grows unboundedly and is eventually handed to decideAndRespond as
// one enormous blob. 25s is well past a normal "split one thought across
// bubbles" pause but still inside the window where a customer is plausibly
// waiting. Ported from watsapin's lib/bot-engine/burst-scheduler.ts, which
// took this file's own debounce as its reference and then found the gap.
const BURST_MAX_WAIT_MS = 25000
```

Change the type and both branches:

```ts
type PendingBurst = {
  texts: string[]
  timer: ReturnType<typeof setTimeout>
  // Wall-clock time the FIRST message of this burst was buffered, so each
  // later message can shorten -- never extend -- the remaining wait.
  firstScheduledAt: number
}
```

```ts
export function scheduleBotRun(conversation: { id: string; contactName: string | null }, inboundText: string): void {
  const existing = pendingBursts.get(conversation.id)
  if (existing) {
    existing.texts.push(inboundText)
    clearTimeout(existing.timer)
    // Trailing-quiet wait, clamped to whatever is left of the max-wait budget.
    // Once that budget is spent this is 0 -- flush on the next tick rather than
    // granting yet another full debounce window.
    const remainingMaxWait = Math.max(0, BURST_MAX_WAIT_MS - (Date.now() - existing.firstScheduledAt))
    existing.timer = setTimeout(() => void flushBurst(conversation), Math.min(BURST_DEBOUNCE_MS, remainingMaxWait))
    return
  }
  pendingBursts.set(conversation.id, {
    texts: [inboundText],
    timer: setTimeout(() => void flushBurst(conversation), BURST_DEBOUNCE_MS),
    firstScheduledAt: Date.now(),
  })
}
```

Note: the test uses fake timers, so `Date.now()` must advance with them. `vi.advanceTimersByTimeAsync` does advance the mocked clock — no extra setup needed.

- [ ] **Step 4: Run the file, then the whole suite**

Run: `npx vitest run src/lib/inbound.test.ts` — expect PASS.
Run: `npm test` — expect all green, with one more test than before.
Run: `npx tsc --noEmit && npx eslint src/lib/inbound.ts` — expect clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/inbound.ts src/lib/inbound.test.ts
git commit -m "Cap the inbound burst debounce at 25s

The trailing debounce restarted on every message with no ceiling, so a
customer who never paused for a full 5 seconds was never replied to at all
and their buffered fragments grew without bound. Ported from watsapin's
burst-scheduler, which took this file as its reference and then closed the
gap this one still had.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Per-conversation rate limiter

**Why:** wa-inbox spends up to seven LLM calls per inbound message and has no ceiling of any kind. One looping or abusive number can burn unbounded Ollama budget. Scoped per conversation, not globally, so one bad number cannot degrade service for everyone else.

**Files:**
- Create: `src/lib/bot/rate-limiter.ts`
- Modify: `src/lib/inbound.ts` (`flushBurst`)
- Test: `src/lib/bot/rate-limiter.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `checkAndRecordRateLimit(conversationId: string): boolean` — `true` while within budget (and records the attempt), `false` once exceeded. `__resetRateLimiterForTests(): void`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/bot/rate-limiter.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { checkAndRecordRateLimit, __resetRateLimiterForTests } from './rate-limiter'

describe('checkAndRecordRateLimit', () => {
  beforeEach(() => __resetRateLimiterForTests())
  afterEach(() => vi.useRealTimers())

  it('allows a normal conversation through', () => {
    for (let i = 0; i < 20; i++) expect(checkAndRecordRateLimit('c1')).toBe(true)
  })

  it('blocks the 21st turn inside the window', () => {
    for (let i = 0; i < 20; i++) checkAndRecordRateLimit('c1')
    expect(checkAndRecordRateLimit('c1')).toBe(false)
  })

  it('scopes the budget per conversation, so one spammer cannot starve another chat', () => {
    for (let i = 0; i < 21; i++) checkAndRecordRateLimit('spammer')
    expect(checkAndRecordRateLimit('someone-else')).toBe(true)
  })

  it('lets the conversation through again once the window has rolled past', () => {
    vi.useFakeTimers()
    for (let i = 0; i < 20; i++) checkAndRecordRateLimit('c1')
    expect(checkAndRecordRateLimit('c1')).toBe(false)
    vi.advanceTimersByTime(10 * 60 * 1000 + 1)
    expect(checkAndRecordRateLimit('c1')).toBe(true)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/bot/rate-limiter.test.ts`
Expected: FAIL — cannot resolve `./rate-limiter`.

- [ ] **Step 3: Implement**

Create `src/lib/bot/rate-limiter.ts`:

```ts
// Cost/abuse guard for the bot brain. Every message that reaches
// decideAndRespond costs up to seven Ollama calls (see orchestrator.ts), so a
// customer -- or an attacker -- messaging in a tight loop would otherwise burn
// budget with no ceiling at all. Ported from watsapin's
// lib/bot-engine/rate-limiter.ts.
//
// Scoped PER CONVERSATION, not per deployment, so one spammy number cannot
// degrade service for every other customer. In-memory and per-process, the
// same accepted tradeoff inbound.ts's own debounce map already makes: a
// restart forgets the counter, which loses an abuse count, never data. No
// customer message is ever dropped by this -- only the automated REPLY is
// skipped; the message itself is already persisted and visible in the inbox.
const WINDOW_MS = 10 * 60 * 1000
const MAX_REPLIES_PER_WINDOW = 20

const requestLog = new Map<string, number[]>()

/**
 * True while this conversation is still within its budget (and records the
 * attempt); false once it has exceeded MAX_REPLIES_PER_WINDOW bot turns inside
 * the last WINDOW_MS.
 */
export function checkAndRecordRateLimit(conversationId: string): boolean {
  const now = Date.now()
  const recent = (requestLog.get(conversationId) ?? []).filter((t) => now - t < WINDOW_MS)

  if (recent.length >= MAX_REPLIES_PER_WINDOW) {
    requestLog.set(conversationId, recent)
    return false
  }

  recent.push(now)
  requestLog.set(conversationId, recent)
  return true
}

// Test-only: vitest's module cache otherwise leaks counters between files that
// happen to reuse a conversation id.
export function __resetRateLimiterForTests(): void {
  requestLog.clear()
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/lib/bot/rate-limiter.test.ts` — expect PASS (4 tests).

- [ ] **Step 5: Wire it into the burst flush**

In `src/lib/inbound.ts`, import it:

```ts
import { checkAndRecordRateLimit } from '@/lib/bot/rate-limiter'
```

In `flushBurst`, extend the existing fresh re-read to also fetch `isTest`, and gate after the `botEnabled` check:

```ts
  const fresh = await prisma.conversation.findUnique({
    where: { id: conversation.id },
    select: { botEnabled: true, isTest: true },
  })
  if (!fresh?.botEnabled) return

  // Cost guard, checked here rather than inside decideAndRespond so a blocked
  // turn costs nothing at all -- not even the escalation classifier. The
  // sandbox conversation is exempt: an admin deliberately hammering it to test
  // bot behavior is exactly who this must not throttle.
  if (!fresh.isTest && !checkAndRecordRateLimit(conversation.id)) {
    console.warn('flushBurst: rate limit exceeded, skipping bot reply', { conversationId: conversation.id })
    return
  }
```

- [ ] **Step 6: Add the integration test**

Add to `src/lib/inbound.test.ts`:

```ts
it('skips the bot reply once a conversation exceeds its rate-limit budget', async () => {
  __resetRateLimiterForTests()
  vi.useFakeTimers()
  const conversation = { id: 'conv_rate', contactName: null }
  prismaMock.conversation.findUnique.mockResolvedValue({ botEnabled: true, isTest: false } as never)
  for (let i = 0; i < 21; i++) {
    scheduleBotRun(conversation, `pesan ${i}`)
    await vi.advanceTimersByTimeAsync(6000)
  }
  // 20 turns answered, the 21st dropped -- the customer's messages are all
  // still persisted by the caller, only the automated reply is skipped.
  expect(decideAndRespond).toHaveBeenCalledTimes(20)
  vi.useRealTimers()
})
```

If `prismaMock` is named differently in that file, use whatever the file already uses; do not introduce a second mocking style.

- [ ] **Step 7: Verify and commit**

Run: `npm test` — expect all green.
Run: `npx tsc --noEmit && npx eslint src/lib/bot/rate-limiter.ts src/lib/inbound.ts` — expect clean.

```bash
git add src/lib/bot/rate-limiter.ts src/lib/bot/rate-limiter.test.ts src/lib/inbound.ts src/lib/inbound.test.ts
git commit -m "Add a per-conversation rate limit before the bot runs

Each inbound message can cost up to seven Ollama calls and nothing bounded
how many a single number could trigger. Gated in flushBurst rather than
inside the orchestrator so a blocked turn costs nothing at all, and exempt
for the sandbox conversation, which exists to be hammered.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Re-check botEnabled after the LLM, before sending

**Why:** `flushBurst` re-reads `botEnabled` *before* `decideAndRespond`, which then spends up to seven LLM calls — tens of seconds. An agent who clicks "Ambil Alih dari Bot" during that window (and very likely already replied by hand) still gets the bot's answer sent on top of them. This is an active bug today.

**Files:**
- Modify: `src/lib/inbound.ts` (`runBotForConversation`)
- Test: `src/lib/inbound.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `runBotForConversation` signature unchanged; it may now return without sending.

- [ ] **Step 1: Write the failing test**

```ts
it('does not send the bot reply when an agent took over during the LLM call', async () => {
  const conversation = { id: 'conv_takeover', contactName: null }
  vi.mocked(decideAndRespond).mockResolvedValue({ mode: 'faq', draft: 'Hi!', sourceTopic: 'general' })
  // botEnabled was true when the turn started; the agent flipped it during
  // decideAndRespond.
  prismaMock.conversation.findUnique.mockResolvedValue({ botEnabled: false, isTest: false } as never)

  await runBotForConversation(conversation, 'halo')

  expect(sendMessage).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/inbound.test.ts -t 'took over'`
Expected: FAIL — `sendMessage` was called once.

- [ ] **Step 3: Implement**

In `runBotForConversation`, immediately after `const decision = await decideAndRespond(...)`:

```ts
  // `botEnabled` was last read before decideAndRespond, which spends up to
  // seven Ollama calls -- tens of seconds. If an agent clicked "Ambil Alih dari
  // Bot" during that window they have almost certainly already replied by hand,
  // and this in-flight turn must not send its own answer on top of them: the
  // customer would get a human message immediately followed by a contradicting
  // bot one. Re-read and abort before anything is stored or dispatched.
  const stillBotDriven = await prisma.conversation.findUnique({
    where: { id: conversation.id },
    select: { botEnabled: true },
  })
  if (!stillBotDriven?.botEnabled) return
```

Place it **before** the `mode` branch, so it also suppresses the handoff acknowledgment — a handoff to a human who has already arrived is noise.

- [ ] **Step 4: Verify**

Run: `npx vitest run src/lib/inbound.test.ts` — expect PASS.
Run: `npm test` — expect all green. Some existing tests mock `findUnique` once; if any now fail because the second call returns `undefined`, change those mocks to `mockResolvedValue` (always) rather than `mockResolvedValueOnce`.
Run: `npx tsc --noEmit && npx eslint src/lib/inbound.ts` — expect clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/inbound.ts src/lib/inbound.test.ts
git commit -m "Re-check botEnabled after the orchestrator returns

The gate was read before decideAndRespond, which can take tens of seconds
across seven Ollama calls. An agent taking the conversation over inside that
window still got the bot's answer sent on top of their own reply. Checked
again before dispatch, covering the handoff acknowledgment too.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Merge tripBrief atomically in Postgres

**Why:** `persistTripBrief` spreads `nextTripBrief` in JavaScript and writes the whole JSON column. `types.ts` already documents the bug this caused (dayCount written, then erased by a later write in the same request); the in-memory accumulator patched the symptom. Two concurrent turns for the same conversation — trivially reachable, since each holds 30s+ of LLM time — still lose one side's fields entirely. Postgres' `jsonb || jsonb` merges under the row lock the UPDATE itself takes.

**Files:**
- Modify: `src/lib/bot/orchestrator.ts` (the `persistTripBrief` closure, ~line 740-755)
- Test: `src/lib/bot/orchestrator.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `persistTripBrief(patch: Partial<TripBrief>): Promise<void>` — signature unchanged. Now issues `$executeRaw`, not `prisma.conversation.update`.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/bot/orchestrator.test.ts`:

```ts
it('merges tripBrief server-side rather than overwriting the whole column', async () => {
  // A read-modify-write across two round trips is a lost-update race: two
  // turns for the same conversation each hold 30s+ of LLM time, and each
  // would write a snapshot taken before the other's write.
  await decideAndRespond('conv_1', 'i want to go to ijen')
  expect(prismaMock.conversation.update).not.toHaveBeenCalled()
  expect(prismaMock.$executeRaw).toHaveBeenCalled()
})
```

Add `$executeRaw: vi.fn()` to the Prisma mock in that file if it is not already present.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/bot/orchestrator.test.ts -t 'merges tripBrief'`
Expected: FAIL — `conversation.update` was called.

- [ ] **Step 3: Implement**

Replace the body of the `persistTripBrief` closure:

```ts
    let nextTripBrief: TripBrief = { ...tripBrief }
    const persistTripBrief = async (patch: Partial<TripBrief>) => {
      // In-memory accumulation is still needed for READS later in this same
      // request (branches below consult nextTripBrief before the DB round trip
      // completes), but the WRITE is now a server-side merge.
      //
      // Postgres replaces a whole JSON column on an ordinary update, so two
      // concurrent turns for this conversation -- each holding 30s+ of LLM time
      // -- would each write a snapshot taken before the other's write, silently
      // dropping one side's fields. `jsonb || jsonb` merges under the row lock
      // the UPDATE itself takes, so a concurrent merge either happens strictly
      // before ours (and is visible to it) or strictly after (and sees ours).
      // The jsonb_typeof guard covers both a SQL NULL column and a stored JSON
      // scalar -- `||` errors on those rather than treating them as {}.
      nextTripBrief = { ...nextTripBrief, ...patch }
      await prisma.$executeRaw`
        UPDATE "Conversation"
        SET "tripBrief" =
              CASE WHEN jsonb_typeof("tripBrief") = 'object' THEN "tripBrief" ELSE '{}'::jsonb END
              || ${JSON.stringify(patch)}::jsonb
        WHERE id = ${conversationId}
      `
    }
```

Note the write now sends only `patch`, not the whole accumulated brief — that is the point. Delete the now-stale part of the block comment above it that explains the accumulator's write-side rationale, and keep the read-side explanation.

- [ ] **Step 4: Verify**

Run: `npx vitest run src/lib/bot/orchestrator.test.ts` — expect PASS. Existing tests asserting `conversation.update` was called with a `tripBrief` payload must be rewritten to assert on `$executeRaw`; there are several, and each one is a real assertion worth keeping in its new form.
Run: `npm test` — expect all green.
Run: `npx tsc --noEmit && npx eslint src/lib/bot/orchestrator.ts` — expect clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/bot/orchestrator.ts src/lib/bot/orchestrator.test.ts
git commit -m "Merge tripBrief in Postgres instead of in JavaScript

types.ts already documents one lost-update this caused within a single
request; the nextTripBrief accumulator fixed that symptom but not the real
case, where two turns for the same conversation each hold 30s of LLM time
and each write a snapshot taken before the other. jsonb || merges under the
row lock the UPDATE already takes.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Cache the catalog on mtime

**Why:** `loadCatalog()` reads and `JSON.parse`s roughly 250 KB across eight files, synchronously, on every inbound message, inside a single always-on Node process. `knowledge.ts` already caches its own modules (`__resetKnowledgeCacheForTests` exists); this file never got the same treatment.

**Files:**
- Modify: `src/lib/bot/catalog.ts`
- Test: `src/lib/bot/catalog.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `loadCatalog(): Catalog` — signature unchanged. `__resetCatalogCacheForTests(): void`.

- [ ] **Step 1: Write the failing test**

```ts
it('parses the catalog once and serves the cached value afterwards', () => {
  __resetCatalogCacheForTests()
  const spy = vi.spyOn(fs, 'readFileSync')
  loadCatalog()
  const firstCallCount = spy.mock.calls.length
  loadCatalog()
  expect(spy.mock.calls.length).toBe(firstCallCount)
  spy.mockRestore()
})

it('re-reads when a catalog file changes on disk', () => {
  __resetCatalogCacheForTests()
  loadCatalog()
  const spy = vi.spyOn(fs, 'readFileSync')
  vi.spyOn(fs, 'statSync').mockReturnValue({ mtimeMs: Date.now() + 10_000 } as never)
  loadCatalog()
  expect(spy).toHaveBeenCalled()
  vi.restoreAllMocks()
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/bot/catalog.test.ts -t 'cached value'`
Expected: FAIL — `readFileSync` called again.

- [ ] **Step 3: Implement**

Above `loadCatalog` in `src/lib/bot/catalog.ts`:

```ts
// The catalog is ~250KB across eight files, read and JSON.parsed synchronously
// on every single inbound message inside one always-on Node process. It only
// ever changes when an operator runs `npm run sync:knowledge` and redeploys,
// so it is cached and invalidated on the newest mtime across the files
// loadCatalog actually reads -- the same shape knowledge.ts's own module cache
// already uses. mtime (not a TTL) means a fresh deploy is picked up on the
// very next message with no restart and no stale window.
const CACHED_FILES = [
  PROFILES_FILE, PRICE_TIERS_FILE, COMPONENTS_FILE, MODULE_COMPATIBILITY_FILE,
  GENERAL_MODULES_FILE, LINK_REGISTRY_FILE, ENDPOINT_CHAINS_FILE, META_FILE,
]

let cachedCatalog: Catalog | null = null
let cachedMtime = -1

function newestCatalogMtime(): number {
  let newest = -1
  for (const fileName of CACHED_FILES) {
    try {
      newest = Math.max(newest, fs.statSync(path.join(CATALOG_DIR, fileName)).mtimeMs)
    } catch {
      // A missing file is already handled (and warned about) by readCatalogFile;
      // it just doesn't contribute an mtime.
    }
  }
  return newest
}

export function __resetCatalogCacheForTests(): void {
  cachedCatalog = null
  cachedMtime = -1
}
```

Rename the existing `loadCatalog` to `buildCatalog` (unexported), and add:

```ts
export function loadCatalog(): Catalog {
  const mtime = newestCatalogMtime()
  if (cachedCatalog && mtime === cachedMtime) return cachedCatalog
  cachedCatalog = buildCatalog()
  cachedMtime = mtime
  return cachedCatalog
}
```

`buildCatalog` returns a fresh object each time it runs, and every consumer treats `Catalog` as read-only, so handing the same instance to several callers is safe. If a reviewer disagrees, the correct fix is to freeze it, not to drop the cache.

- [ ] **Step 4: Verify**

Run: `npx vitest run src/lib/bot/catalog.test.ts src/lib/bot/catalog.real.test.ts` — expect PASS. Any existing test that writes a temp catalog and re-reads it must call `__resetCatalogCacheForTests()` in its `beforeEach`; add that call rather than weakening the cache.
Run: `npm test` — expect all green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/bot/catalog.ts src/lib/bot/catalog.test.ts
git commit -m "Cache the parsed catalog, invalidated on file mtime

250KB of JSON was read and parsed synchronously on every inbound message in
a single-process Node deployment. knowledge.ts already caches its modules;
this file never got the same treatment. Keyed on mtime rather than a TTL so
a redeploy is picked up on the next message with no stale window.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Run the classifiers in parallel

**Why:** the main path awaits seven LLM calls one after another (`orchestrator.ts` lines 692, 784, 842, 852, 918, 928, 1295), each with its own 10s timeout. Six of them are classifiers that read nothing but `inboundText`. Nothing in the flow requires them to be sequential.

Two independent wins:
1. The escalation classifier and the Booking API lookup are unrelated I/O — run them together.
2. The five Mode 1/2 classifiers become one batch. `matchDestination` is **synchronous** (a catalog scan), so the branch is known *before* any of them runs — the no-destination branch therefore batches only the two it actually needs, wasting nothing.

Result: **three sequential waits** on the main path instead of seven.

**Files:**
- Modify: `src/lib/bot/orchestrator.ts`
- Test: `src/lib/bot/orchestrator.test.ts`, `src/lib/bot/orchestrator.real.test.ts`

**Interfaces:**
- Consumes: `loadCatalog()` from Task 5 (now cached — this task moves it earlier in the flow, which the cache makes free).
- Produces: `runNoDestinationBranch(...)` gains a `resolverTopic: ResolverTopic` parameter and **no longer calls `classifyTopicViaLLM` itself**. New signature:

```ts
async function runNoDestinationBranch(
  inboundText: string,
  conversationId: string,
  ollamaModel: string,
  resolverTopic: ResolverTopic,
  catalog: Catalog,
  unsupportedOriginCity: string | null,
  routeLegNote: string,
  keywordModuleIds: string[],
  trace: Tracer
): Promise<BotDecision>
```

(The `job` parameter is removed — it existed only to feed `classifyTopicViaLLM`'s regex fallback, which now happens at the call site.)

- [ ] **Step 1: Write the failing test**

Add to `src/lib/bot/orchestrator.test.ts`:

```ts
it('runs the Mode 1/2 classifiers concurrently, not one after another', async () => {
  // Each classifier resolves only after the next tick; if they were awaited in
  // sequence the total would be the sum of their delays. Concurrency is
  // asserted by the fact that all five are in flight before any resolves.
  const inFlight: string[] = []
  const gate = (name: string, value: unknown) => () => {
    inFlight.push(name)
    return new Promise((resolve) => setTimeout(() => resolve(value), 0))
  }
  vi.mocked(classifyKeywordModulesViaLLM).mockImplementation(gate('keyword', { moduleIds: [], source: 'llm' }) as never)
  vi.mocked(classifyTopicViaLLM).mockImplementation(gate('topic', { topic: 'price', source: 'llm' }) as never)
  vi.mocked(extractTripPreferences).mockImplementation(gate('prefs', { preferences: NO_PREFS, source: 'llm' }) as never)
  vi.mocked(detectsPreferenceDeclineViaLLM).mockImplementation(gate('decline', { declined: false, source: 'llm' }) as never)
  vi.mocked(detectsRecommendationIntentViaLLM).mockImplementation(gate('reco', { isRecommendation: false, source: 'llm' }) as never)

  await decideAndRespond('conv_1', 'berapa harga paket ijen 3 hari dari surabaya?')

  // All five entered before the event loop drained any of them.
  expect(inFlight).toHaveLength(5)
})

it('does not run the recommendation/preference classifiers when no destination is known', async () => {
  vi.mocked(matchDestination).mockReturnValue(null)
  await decideAndRespond('conv_no_dest', 'boleh COD?')
  expect(extractTripPreferences).not.toHaveBeenCalled()
  expect(detectsPreferenceDeclineViaLLM).not.toHaveBeenCalled()
  expect(detectsRecommendationIntentViaLLM).not.toHaveBeenCalled()
})
```

Define `NO_PREFS` locally as `{ origin: null, dayCount: null, finishCity: null, pax: null }`.

- [ ] **Step 2: Run and watch fail**

Run: `npx vitest run src/lib/bot/orchestrator.test.ts -t 'concurrently'`
Expected: FAIL — `inFlight` has 1 entry at the time of assertion.

- [ ] **Step 3: Pair the escalation check with the booking lookup**

Replace the sequential escalation-then-booking block:

```ts
    trace.push('Pesan diterima', 'Memeriksa apakah pesan mengandung kata kunci eskalasi (komplain, refund, minta manusia, dll).')
    if (isEscalation(inboundText)) {
      trace.push('Eskalasi terdeteksi', 'Pesan cocok dengan kata kunci eskalasi -- langsung diserahkan ke agen tanpa pemrosesan lebih lanjut.')
      return { mode: 'handoff', reason: 'Kata kunci eskalasi terdeteksi', steps: trace.steps }
    }

    const conversation = await prisma.conversation.findUniqueOrThrow({
      where: { id: conversationId },
      include: { contact: true },
    })

    // The escalation classifier reads only `inboundText` and the booking lookup
    // reads only the conversation -- they share nothing, so the second no longer
    // waits on the first. The keyword gate above still runs first and still
    // wins: it is free, and it short-circuits before either of these starts.
    trace.push('Mencari data booking', 'Mengecek data booking dan sinyal eskalasi tambahan secara paralel.')
    const [additionalEscalation, bookingData] = await Promise.all([
      detectsAdditionalEscalationSignal(inboundText, settings.ollamaModel),
      ensureFreshBookingData(conversation),
    ])
    if (additionalEscalation) {
      trace.push('Eskalasi terdeteksi (LLM)', 'Model LLM mendeteksi sinyal komplain/permintaan manusia/kemitraan B2B yang tidak tertangkap kata kunci -- diserahkan ke agen.')
      return { mode: 'handoff', reason: 'Sinyal eskalasi terdeteksi oleh model LLM', steps: trace.steps }
    }
    trace.push('Tidak ada eskalasi', 'Tidak ditemukan kata kunci maupun sinyal eskalasi lain pada pesan ini.')
```

The escalation check must still be evaluated **before** the `if (bookingData)` Mode 3 branch, exactly as now — a booked customer with a complaint still reaches a human.

- [ ] **Step 4: Hoist the destination match above every classifier**

`matchDestination` is synchronous. Move the `loadCatalog()` / `unsupportedOriginCity` / `routeLegFacts` / `classifySalesNeed` / J5 / `matchDestination` / destination-persist block so it sits **before** the first classifier call, unchanged in behavior. Then branch:

```ts
    // Both branches need these two; only the destination-known branch needs the
    // other three. `matchDestination` is a synchronous catalog scan, so the
    // branch is known before any LLM call is made and the no-destination path
    // spends two calls rather than five.
    if (!destination) {
      const [keywordModuleResult, topicResult] = await Promise.all([
        classifyKeywordModulesViaLLM(inboundText, settings.ollamaModel),
        classifyTopicViaLLM(classification.job, inboundText, settings.ollamaModel),
      ])
      trace.push(
        'Memeriksa modul fakta kata kunci',
        keywordModuleResult.source === 'llm'
          ? `Diperiksa oleh model LLM lokal -- ${keywordModuleResult.moduleIds.length} modul cocok.`
          : `Model LLM gagal/timeout -- fallback ke pemindaian kata kunci lama, ${keywordModuleResult.moduleIds.length} modul cocok.`
      )
      return await runNoDestinationBranch(
        inboundText,
        conversationId,
        settings.ollamaModel,
        topicResult.topic,
        catalog,
        unsupportedOriginCity,
        routeLegNote,
        keywordModuleResult.moduleIds,
        trace
      )
    }
    trace.push('Destinasi ditemukan', `Destinasi: "${destination}".`)

    const [
      { moduleIds: keywordModuleIds, source: keywordModuleSource },
      { topic: resolverTopic, source: topicSource },
      { preferences, source: preferencesSource },
      { declined: preferenceDeclineSignal, source: declineSource },
      { isRecommendation: recommendationIntentSignal, source: recommendationSource },
    ] = await Promise.all([
      classifyKeywordModulesViaLLM(inboundText, settings.ollamaModel),
      classifyTopicViaLLM(classification.job, inboundText, settings.ollamaModel),
      extractTripPreferences(inboundText, settings.ollamaModel),
      detectsPreferenceDeclineViaLLM(inboundText, isUnknownPreferenceSignal, settings.ollamaModel),
      detectsRecommendationIntentViaLLM(inboundText, isRecommendationRequest, settings.ollamaModel),
    ])
```

Then move the five existing `trace.push(...)` calls for these classifiers to directly after the batch, in the same order and with the same wording. Delete the five original `await` call sites.

- [ ] **Step 5: Update `runNoDestinationBranch`**

Delete its internal `const { topic: preDestinationTopic } = await classifyTopicViaLLM(job, inboundText, ollamaModel)` line, replace the `job` parameter with `resolverTopic: ResolverTopic`, and rename every use of `preDestinationTopic` to `resolverTopic`.

- [ ] **Step 6: Fix the test suite**

Run: `npm test`. Expect a batch of failures in `orchestrator.test.ts` and `orchestrator.real.test.ts` from index-based assertions like `vi.mocked(callLLM).mock.calls[2]` — the call order genuinely changed. This is expected and is most of this task's work.

For each failure: assert on **which mock was called with what**, not on its position. Replace `mock.calls[N][0]` with `expect(callLLM).toHaveBeenCalledWith(expect.stringContaining('...'), expect.objectContaining({ system: expect.stringContaining('...') }))`. Do not simply renumber the indices — that reintroduces the same brittleness the next reorder will break again.

- [ ] **Step 7: Verify**

Run: `npm test` — expect all green, with two more tests than before.
Run: `npx tsc --noEmit && npx eslint src/lib/bot/orchestrator.ts` — expect clean.

- [ ] **Step 8: Commit**

```bash
git add src/lib/bot/orchestrator.ts src/lib/bot/orchestrator.test.ts src/lib/bot/orchestrator.real.test.ts
git commit -m "Run the bot classifiers concurrently instead of in sequence

The main path awaited seven Ollama calls one after another, each with its own
10s timeout, though six of them are classifiers reading nothing but the
inbound text. The escalation check now runs alongside the booking lookup, and
because matchDestination is a synchronous catalog scan the branch is known
before any classifier starts -- so the no-destination path batches the two it
needs and the destination path batches five. Three sequential waits instead
of seven, with no change to any reply.

Test assertions that keyed off call index were rewritten to key off the mock
and its arguments; the indices genuinely moved, and renumbering them would
only defer the same breakage to the next reorder.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

**Phase 1 gate:** `npm test` green, `npx tsc --noEmit` clean, `npx eslint` clean. No reply text has changed. Stop and report before starting Phase 2.

---

# Phase 2 — Answer accuracy

These tasks change what the bot says. Each one either adds a fact it already had but could not reach, or stops it asserting something untrue.

---

### Task 7: Reconnect the orphaned knowledge modules

**Why:** 24 of `general-modules.json`'s 77 modules are unreachable through any of the five resolution paths. Three groups matter:

1. Seven `inclusion_component` modules plus `policy_inclusions_exclusions` are `scope: "global"`, and `catalog.ts`'s `buildNoteIndex` explicitly skips global scope — so the facts that apply to *every* package are the ones filtered out. They are also absent from `TOPIC_MODULES.inclusions`.
2. Three `route_leg_*` modules describe legs whose node pair is already claimed by a different module in `ROUTE_LEG_MODULE_BY_PAIR`, which holds one id per pair. A hotel pickup and an airport pickup are genuinely different drives; both should be offered.
3. `policy_ijen_health_screening` and `policy_ijen_monthly_closure` (Ijen closes to all visitors on the first Friday of each month for the Rijik ceremony) reach the prompt **only** via `pkg.policyNotes`, which is only merged when the route gate happens to return `needs_review`, and only for the single anchor package. A customer can currently be encouraged to book a date the mountain is shut.

**Files:**
- Modify: `src/lib/bot/knowledge.ts`
- Test: `src/lib/bot/knowledge.test.ts`, `src/lib/bot/knowledge.real.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `ROUTE_LEG_MODULE_BY_PAIR` changes type from `Record<string, string>` to `Record<string, string[]>`. It is module-private; no other file imports it.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/bot/knowledge.real.test.ts` (which runs against the real committed catalog):

```ts
it('answers an inclusions question from the global inclusion-component modules', () => {
  const k = resolveKnowledgeForTopic('inclusions', 'what exactly is included?', 'bromo')
  const joined = k.factualLines.join(' ').toLowerCase()
  expect(joined).toContain('drinking water')
  expect(joined).toContain('entrance fees')
})

it('surfaces the Ijen monthly closure on a readiness question about Ijen', () => {
  const k = resolveKnowledgeForTopic('destination_readiness', 'is the hike difficult?', 'ijen')
  const joined = [...k.factualLines, ...k.disclosures].join(' ').toLowerCase()
  expect(joined).toContain('first friday')
})

it('does not leak Ijen-only policies into a Bromo readiness question', () => {
  const k = resolveKnowledgeForTopic('destination_readiness', 'is the hike difficult?', 'bromo')
  expect(k.factualLines.join(' ').toLowerCase()).not.toContain('first friday')
})

it('offers both the airport and hotel drives for Surabaya to Bromo', () => {
  const facts = resolveRouteLegFacts('how many hours from surabaya to bromo?')
  expect(facts).toHaveLength(2)
  expect(facts.join(' ')).toContain('Surabaya Hotel to Bromo Area')
})
```

- [ ] **Step 2: Run and watch fail**

Run: `npx vitest run src/lib/bot/knowledge.real.test.ts`
Expected: all four FAIL.

- [ ] **Step 3: Add the global inclusion modules to the topic map**

In `TOPIC_MODULES`, replace the `inclusions` entry:

```ts
  // The seven `inclusion_component` modules and `policy_inclusions_exclusions`
  // are `scope: "global"`, and catalog.ts's buildNoteIndex deliberately skips
  // global scope (a global fact is not a per-package policy note). Nothing else
  // ever picked them up either, so the facts that apply to EVERY package were
  // the only ones with no route into a reply at all -- listed explicitly here,
  // which is the path built for exactly this.
  inclusions: [
    'inclusion_all_inclusive_baseline',
    'exclusion_standard',
    'policy_inclusions_exclusions',
    'inclusion_private_transport',
    'inclusion_dedicated_crew',
    'inclusion_entrance_permits',
    'inclusion_drinking_water',
    'inclusion_stated_meals',
    'inclusion_pickup_dropoff_assistance',
  ],
```

- [ ] **Step 4: Route the Ijen-scoped policies through the existing Ijen check**

`resolveKnowledgeForTopic` already computes `hasIjen`. Move that computation above the `resolvedModules` filter and add, right after the `destination_readiness` block that appends `destination_${...}`:

```ts
  // Ijen's mandatory health screening and its monthly Rijik closure (the crater
  // shuts to ALL visitors on the first Friday of each month) previously reached
  // a prompt only through pkg.policyNotes -- which is merged only when the route
  // gate happens to return `needs_review`, and only for the single anchor
  // package. A customer could therefore be encouraged to book a date the
  // mountain is closed. Gated on Ijen specifically so a Bromo question never
  // picks them up.
  if (hasIjen && (topic === 'destination_readiness' || topic === 'blue_fire' || topic === 'inclusions')) {
    moduleIds.push('policy_ijen_health_screening', 'policy_ijen_monthly_closure')
  }
```

`hasIjen` currently reads `low.includes('ijen') || destination?.toLowerCase() === 'ijen'` — keep it exactly as-is, only move it earlier in the function.

- [ ] **Step 5: Let one node pair carry several legs**

Change the map's type and the three orphaned entries:

```ts
// A pair can legitimately have MORE THAN ONE real leg: a Surabaya hotel pickup
// and a Surabaya airport pickup are different drives with different published
// durations, and a single-id map silently kept only whichever was written
// first. Returning both, in listed order, is more accurate than picking one --
// the customer knows which of the two applies to them, and the model is told
// both rather than asserting the wrong one.
const ROUTE_LEG_MODULE_BY_PAIR: Record<string, string[]> = {
  'surabaya:bromo': ['route_leg_surabaya_airport_to_bromo_area', 'route_leg_surabaya_hotel_to_bromo_area'],
  'bromo:madakaripura': ['route_leg_bromo_area_to_madakaripura'],
  'bromo:ijen': ['route_leg_bromo_area_to_bondowoso_ijen_area'],
  'bromo:bondowoso': ['route_leg_bromo_area_to_bondowoso_ijen_area'],
  'bondowoso:ijen': ['route_leg_bondowoso_ijen_area_to_ijen_crater', 'route_leg_bondowoso_to_ijen_base'],
  'ijen:ketapang': ['route_leg_ijen_area_to_ketapang_harbor', 'route_leg_ijen_base_to_ketapang_harbor'],
  'surabaya:ijen': ['route_leg_surabaya_to_bondowoso_ijen_area'],
  'surabaya:tumpak sewu': ['route_leg_surabaya_to_tumpak_sewu'],
  'tumpak sewu:bromo': ['route_leg_tumpak_sewu_to_bromo_area'],
  'banyuwangi:ijen': ['route_leg_banyuwangi_to_ijen_base'],
  'ketapang:gilimanuk': ['route_leg_ketapang_harbor_to_gilimanuk_bali_side'],
  'bali:ijen': ['route_leg_bali_hotel_area_to_banyuwangi_ijen_area'],
  'bali:banyuwangi': ['route_leg_bali_hotel_area_to_banyuwangi_ijen_area'],
  'bromo:malang': ['route_leg_bromo_area_to_malang'],
  'malang:surabaya': ['route_leg_malang_to_surabaya'],
}
```

And in `resolveRouteLegFacts`, replace the single-id lookup with an inner loop:

```ts
      const moduleIds =
        ROUTE_LEG_MODULE_BY_PAIR[`${nodes[i]}:${nodes[j]}`] ?? ROUTE_LEG_MODULE_BY_PAIR[`${nodes[j]}:${nodes[i]}`] ?? []
      for (const moduleId of moduleIds) {
        if (seen.has(moduleId)) continue
        const m = modules[moduleId]
        if (!m || m.customer_visible === false || !m.short_answer) continue
        seen.add(moduleId)
        facts.push(m.short_answer)
      }
```

- [ ] **Step 6: Verify**

Run: `npx vitest run src/lib/bot/knowledge.test.ts src/lib/bot/knowledge.real.test.ts` — expect PASS.
Run: `npm test` — expect all green. Some `orchestrator.test.ts` fixtures assert an exact `factualLines` length for the `inclusions` topic; update the expected counts.
Run: `npx tsc --noEmit && npx eslint src/lib/bot/knowledge.ts` — expect clean.

- [ ] **Step 7: Commit**

```bash
git add src/lib/bot/knowledge.ts src/lib/bot/knowledge.test.ts src/lib/bot/knowledge.real.test.ts
git commit -m "Reconnect 12 approved knowledge modules nothing could reach

The seven inclusion components and policy_inclusions_exclusions are global
scope, which buildNoteIndex deliberately skips -- so the facts true of every
package were the only ones with no path into a reply. Ijen's health screening
and its first-Friday Rijik closure reached a prompt only when the route gate
happened to return needs_review, meaning a customer could be encouraged to
book a date the crater is shut. And a node pair can carry more than one real
leg: a hotel pickup and an airport pickup are different drives, and the map
kept only whichever was written first.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Read the accommodation, vehicle and crew rules

**Why:** `catalog/accommodation-rules.json` (37 KB) lists the actual overnight hotels per package — `["Joglo Kecombrang Bromo", "Riverside Homestay"]` — and nothing in `src/` opens the file. Meanwhile `knowledge.ts`'s hotel disclosure instructs the model to *send the customer to the package page* for hotel names. The same is true of `vehicle-and-luggage-rules.json` (`"AC MPV for 1-3 guests; Hiace for 4-9 guests"`) and `guide-support-rules.json` (crew roles, language note). Three of the most common question types are answered generically from data that is on disk, approved, and per-package.

**Files:**
- Modify: `src/lib/bot/types.ts` (`CatalogPackage`)
- Modify: `src/lib/bot/catalog.ts` (`buildCatalog` + a new index builder)
- Modify: `src/lib/bot/knowledge.ts` (`getTopicDisclosures` hotel line)
- Modify: `src/lib/bot/orchestrator.ts` (system-prompt logistics block)
- Test: `src/lib/bot/catalog.real.test.ts`, `src/lib/bot/orchestrator.real.test.ts`

**Interfaces:**
- Consumes: `loadCatalog()`/`buildCatalog()` from Task 5.
- Produces: `CatalogPackage` gains, all defaulting to `[]` / `null` when the source row is missing:

```ts
  overnights: string[]
  roomingAssumption: string | null
  vehicleCategory: string | null
  luggageRule: string | null
  crewRoles: string | null
  languageNote: string | null
```

- [ ] **Step 1: Write the failing test**

Add to `src/lib/bot/catalog.real.test.ts`:

```ts
it('carries the real overnight hotels, vehicle class and crew note per package', () => {
  const catalog = loadCatalog()
  const pkg = catalog.packages.find((p) => p.packageKey === 'bali/bromo-ijen-3d2n')!
  expect(pkg.overnights).toContain('Joglo Kecombrang Bromo')
  expect(pkg.vehicleCategory).toContain('MPV')
  expect(pkg.crewRoles).toBeTruthy()
  // luggage_rule is null for every package in the current release (see
  // catalog/gap-report.json: 16 of the 17 recorded gaps) -- absence must be
  // carried honestly as null, never invented.
  expect(pkg.luggageRule).toBeNull()
})
```

- [ ] **Step 2: Run and watch fail**

Run: `npx vitest run src/lib/bot/catalog.real.test.ts -t 'overnight hotels'`
Expected: FAIL — property does not exist.

- [ ] **Step 3: Extend the type**

In `src/lib/bot/types.ts`, add to `CatalogPackage` with this comment:

```ts
  // accommodation-rules.json / vehicle-and-luggage-rules.json /
  // guide-support-rules.json, joined on package_key the same way policyNotes
  // and stagingNotes already are. All three files shipped with the release and
  // NOTHING in src/ ever opened them -- so "which hotel do we stay at?" was
  // deferred to the package page by a disclosure in knowledge.ts even though
  // the real names sit right here, and "what vehicle?" was answered from a
  // generic per-pax module instead of this package's own class.
  // `luggageRule` is null for every package in the current release (see
  // catalog/gap-report.json) -- carried as null rather than omitted, so the
  // absence is a fact the prompt can state honestly instead of guessing.
  overnights: string[]
  roomingAssumption: string | null
  vehicleCategory: string | null
  luggageRule: string | null
  crewRoles: string | null
  languageNote: string | null
```

- [ ] **Step 4: Read the three files**

In `src/lib/bot/catalog.ts`, add the filenames beside the existing constants:

```ts
const ACCOMMODATION_FILE = 'accommodation-rules.json'
const VEHICLE_FILE = 'vehicle-and-luggage-rules.json'
const GUIDE_FILE = 'guide-support-rules.json'
```

Add all three to `CACHED_FILES` from Task 5.

In `buildCatalog`, alongside the existing index builds:

```ts
  const accommodation = indexByPackageKey(readCatalogFile(ACCOMMODATION_FILE), ACCOMMODATION_FILE)
  const vehicle = indexByPackageKey(readCatalogFile(VEHICLE_FILE), VEHICLE_FILE)
  const guide = indexByPackageKey(readCatalogFile(GUIDE_FILE), GUIDE_FILE)
```

And in the `packages.push({...})` literal:

```ts
      overnights: asStringArray(accommodation.get(packageKey)?.overnights),
      roomingAssumption: asString(accommodation.get(packageKey)?.rooming_assumption),
      vehicleCategory: asString(vehicle.get(packageKey)?.vehicle_category),
      luggageRule: asString(vehicle.get(packageKey)?.luggage_rule),
      crewRoles: asString(guide.get(packageKey)?.crew_roles),
      languageNote: asString(guide.get(packageKey)?.language_note),
```

`asString` already returns `null` for a non-string (including JSON `null`), and `asStringArray` already returns `[]` for a missing array — no extra guards needed. Fix the two `CatalogPackage` literals in `src/lib/bot/catalog.test.ts` fixtures that `tsc` will now flag.

- [ ] **Step 5: Ground the prompt in it**

In `orchestrator.ts`, immediately after the existing `pkg.stagingNotes` block in the system prompt, add:

```ts
      // Per-package logistics the customer most often asks about, stated as
      // fact rather than deferred to a link. Each line is omitted when the
      // release genuinely has no value for it -- an absent luggage allowance
      // (true for every package today) must read as "we'll confirm", never as
      // an invented number.
      ((): string => {
        const lines = [
          pkg.overnights.length > 0 ? `Overnight stays for this package, in night order: ${pkg.overnights.join(' then ')}. State these names directly if asked which hotel they stay at.` : null,
          pkg.roomingAssumption ? `Rooming: ${pkg.roomingAssumption}` : null,
          pkg.vehicleCategory ? `Vehicle for this package: ${pkg.vehicleCategory}` : null,
          pkg.luggageRule ? `Luggage allowance: ${pkg.luggageRule}` : null,
          pkg.crewRoles ? `Crew: ${pkg.crewRoles}` : null,
          pkg.languageNote ? `Guide language: ${pkg.languageNote}` : null,
        ].filter((l): l is string => l !== null)
        return lines.length > 0 ? `\n\nLogistics for this specific package:\n${lines.map((l) => `- ${l}`).join('\n')}` : ''
      })() +
```

- [ ] **Step 6: Retire the "go look at the page" hotel disclosure**

In `knowledge.ts`'s `getTopicDisclosures`, replace the hotel line:

```ts
    // Was: "point the customer to this package's own detail page -- that's
    // where it's listed." As of the accommodation-rules join (catalog.ts) the
    // real overnight names are in the prompt itself, so sending the customer
    // away to look up a fact we just handed the model was strictly worse.
    // Kept as a hedge only for the case where that list is genuinely empty.
    out.push('If the specific overnight hotel names are given in the package logistics above, state them directly; only if they are absent, say our team will confirm the exact property.')
```

- [ ] **Step 7: Add the end-to-end assertion**

In `src/lib/bot/orchestrator.real.test.ts` (LLM mocked, catalog real):

```ts
it('puts the real overnight hotel names in the prompt for a hotel question', async () => {
  await decideAndRespond('conv_1', 'which hotel do we stay at for the 3 day bromo ijen tour from bali?')
  const system = vi.mocked(callLLM).mock.lastCall![1]!.system!
  expect(system).toContain('Joglo Kecombrang Bromo')
  expect(system).not.toContain("that's where it's listed")
})
```

- [ ] **Step 8: Verify and commit**

Run: `npm test` — expect all green.
Run: `npx tsc --noEmit && npx eslint src/lib/bot` — expect clean.

```bash
git add src/lib/bot/types.ts src/lib/bot/catalog.ts src/lib/bot/catalog.test.ts src/lib/bot/catalog.real.test.ts src/lib/bot/knowledge.ts src/lib/bot/orchestrator.ts src/lib/bot/orchestrator.real.test.ts
git commit -m "Answer hotel, vehicle and crew questions from the release data

accommodation-rules.json holds the real overnight property names per package
and nothing in src/ had ever opened it -- while a disclosure in knowledge.ts
told the model to send the customer to the package page to look up a fact
sitting on disk. Same for the per-package vehicle class and crew note. The
luggage allowance stays null, as the release records it, so its absence is
stated honestly rather than filled in.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Scope finishCityFact to the message that asked

**Why:** `finishCity` persists across turns by design (`types.ts` documents why). But `finishCityFact` is built from the *merged* value, so it injects the sentence *"The customer asked whether the trip can finish/end in Bali"* into every later prompt in the conversation. A customer who mentioned Bali once on message two is still being answered about drop-off points on message ten, when they asked about breakfast. `unsupportedOriginNote` right beside it already gets this right — it reads only the current message.

**Files:**
- Modify: `src/lib/bot/orchestrator.ts` (~line 1194)
- Test: `src/lib/bot/orchestrator.real.test.ts`

**Interfaces:**
- Consumes: `preferences` from Task 6's batch.
- Produces: no signature change.

- [ ] **Step 1: Write the failing test**

```ts
it('stops asserting a finish-city question the customer only asked earlier', async () => {
  prismaMock.conversation.findUniqueOrThrow.mockResolvedValue({
    id: 'conv_1',
    contact: { phone: '628123' },
    tripBrief: { destination: 'ijen', finishCity: 'bali', origin: 'Surabaya', dayCount: 3 },
    botEnabled: true,
  } as never)
  // This message is about breakfast. finishCity is only on file from an
  // earlier turn.
  await decideAndRespond('conv_1', 'is breakfast included every morning?')
  const system = vi.mocked(callLLM).mock.lastCall![1]!.system!
  expect(system).not.toContain('The customer asked whether the trip can finish')
})

it('still answers the finish-city question on the message that asks it', async () => {
  await decideAndRespond('conv_1', 'can we finish the trip in Bali?')
  const system = vi.mocked(callLLM).mock.lastCall![1]!.system!
  expect(system).toContain('The customer asked whether the trip can finish')
})
```

- [ ] **Step 2: Run and watch fail**

Run: `npx vitest run src/lib/bot/orchestrator.real.test.ts -t 'finish-city'`
Expected: first test FAILs (the sentence is present).

- [ ] **Step 3: Implement**

Change the guard from the merged `finishCity` to this message's own value, leaving the body untouched:

```ts
    // Built from `preferences.finishCity` (THIS message) rather than the merged
    // `finishCity`, which persists across turns by design. Reading the merged
    // value asserted "The customer asked whether the trip can finish in X" into
    // every later prompt in the conversation, so a customer who named a finish
    // city on message two was still being answered about drop-off points on
    // message ten while asking about breakfast. `unsupportedOriginNote` right
    // above already reads only the current message; this is the same rule.
    // The merged value is still what NARROWS the package pool -- only the
    // "they asked about this" assertion is scoped to the asking message.
    const askedFinishCity = preferences.finishCity
    const finishCityFact = !askedFinishCity
      ? ''
      : optionPackages.some((p) => p.finishCities.includes(askedFinishCity))
        ? `\n\nThe customer asked whether the trip can finish/end in ${titleCaseCity(askedFinishCity)} -- yes, at least one of the matching packages above genuinely can (see which ones say "finishes in ${titleCaseCity(askedFinishCity)}"); do not claim every package does.`
        : `\n\nThe customer asked whether the trip can finish/end in ${titleCaseCity(askedFinishCity)} -- be honest: none of the matching packages for this destination are set up to finish there. Say so clearly and mention our team can advise on custom routing if they specifically need this.`
```

Leave `narrowPackagePool`, `pickPackage` and the per-option `finishNote` reading the merged `finishCity` — those are correct as they are.

- [ ] **Step 4: Verify and commit**

Run: `npm test` — expect all green. Existing tests that set `finishCity` only in `tripBrief` and assert the sentence appears must be split into the two cases above; that distinction is the bug being fixed, so do not weaken the assertion to make them pass.

```bash
git add src/lib/bot/orchestrator.ts src/lib/bot/orchestrator.real.test.ts
git commit -m "Only claim the customer asked about a finish city on the message that asks

finishCity persists across turns on purpose, but the prompt sentence built
from it asserted the question was being asked every turn after -- so someone
who named Bali once on message two kept getting drop-off answers on message
ten while asking about breakfast. The merged value still narrows the package
pool; only the assertion is scoped to the asking message, matching what
unsupportedOriginNote beside it already did.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Verify prices and URLs before sending

**Why:** after `callLLM` returns, the only check is `!reply.trim()`. Every "never invent a price or URL" rule lives inside the prompt text. For this bot that is the most expensive gap available: prices are per-pax tiers, so quoting the wrong tier is a subtle, costly error, and `knowledge.ts` records that the link registry once shipped 18 broken "existing" URLs.

Ported from watsapin's `lib/bot-engine/price-guard.ts`, extended with URL checking, and with the two-severity design that repo established — because this bot legitimately does arithmetic in an order summary.

**Files:**
- Create: `src/lib/bot/reply-verifier.ts`
- Modify: `src/lib/bot/orchestrator.ts`
- Test: `src/lib/bot/reply-verifier.test.ts`, `src/lib/bot/orchestrator.test.ts`

**Interfaces:**
- Consumes: `CatalogPackage.priceTiers`, `priceForPax` (existing).
- Produces:

```ts
export function extractRupiahAmounts(text: string): number[]
export function extractUrls(text: string): string[]
export type VerificationResult = {
  fabricatedPrices: number[]   // no price in the grounding at all -- block
  unverifiedPrices: number[]   // grounding had prices, this is not one/derivable -- advise
  unknownUrls: string[]        // not in the link registry or any package link -- block
}
export function verifyReply(params: {
  replyText: string
  groundedAmounts: number[]
  groundedUrls: string[]
}): VerificationResult
export function buildVerificationRetryInstruction(result: VerificationResult): string
```

- [ ] **Step 1: Write the failing test**

Create `src/lib/bot/reply-verifier.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { extractRupiahAmounts, extractUrls, verifyReply } from './reply-verifier'

describe('extractRupiahAmounts', () => {
  it.each([
    ['Rp4.050.000', 4050000],
    ['Rp 4.050.000/person', 4050000],
    ['IDR 7.500.000', 7500000],
  ])('reads %s', (text, expected) => expect(extractRupiahAmounts(text)).toEqual([expected]))

  it('ignores pax counts, day counts and years', () => {
    expect(extractRupiahAmounts('a 3D2N trip for 4 people in 2026')).toEqual([])
  })

  it('does not read the "k" of an ordinary word as a thousands suffix', () => {
    // Found live in watsapin: "Rp3.500 kalau ambil satu" parsed as Rp3.500.000.
    expect(extractRupiahAmounts('Rp150.000 kalau ambil satu')).toEqual([150000])
  })
})

describe('verifyReply', () => {
  const tiers = [4050000, 7500000]
  const urls = ['https://javavolcano-touroperator.com/tours/from-bali/bromo-ijen-3d2n']

  it('passes a reply quoting a real tier and a real link', () => {
    expect(verifyReply({
      replyText: `It's Rp4.050.000/person. Details: ${urls[0]}`,
      groundedAmounts: tiers, groundedUrls: urls,
    })).toEqual({ fabricatedPrices: [], unverifiedPrices: [], unknownUrls: [] })
  })

  it('blocks a price when the grounding published none at all', () => {
    const r = verifyReply({ replyText: 'It is Rp2.000.000 per person', groundedAmounts: [], groundedUrls: urls })
    expect(r.fabricatedPrices).toEqual([2000000])
  })

  it('only advises when the grounding did publish prices', () => {
    const r = verifyReply({ replyText: 'It is Rp9.999.999 per person', groundedAmounts: tiers, groundedUrls: urls })
    expect(r.fabricatedPrices).toEqual([])
    expect(r.unverifiedPrices).toEqual([9999999])
  })

  it('accepts a group total derived from a real per-person tier', () => {
    // 2 x Rp4.050.000 -- a legitimate sum the bot is expected to do.
    const r = verifyReply({ replyText: 'For 2 people that is Rp8.100.000 total', groundedAmounts: tiers, groundedUrls: urls })
    expect(r.unverifiedPrices).toEqual([])
  })

  it('blocks a URL that is in no registry', () => {
    const r = verifyReply({
      replyText: 'See https://javavolcano-touroperator.com/tours/made-up-package',
      groundedAmounts: tiers, groundedUrls: urls,
    })
    expect(r.unknownUrls).toEqual(['https://javavolcano-touroperator.com/tours/made-up-package'])
  })

  it('strips trailing sentence punctuation from a URL', () => {
    // "See https://example.com/page." -- the full stop is formatting, and
    // treating it as part of the URL would flag a perfectly good link.
    expect(extractUrls('See https://javavolcano-touroperator.com/tours/x.')).toEqual([
      'https://javavolcano-touroperator.com/tours/x',
    ])
  })
})
```

- [ ] **Step 2: Run and watch fail**

Run: `npx vitest run src/lib/bot/reply-verifier.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `reply-verifier.ts`**

Port `~/Code/watsapin/lib/bot-engine/price-guard.ts` verbatim for `extractRupiahAmounts` / `parseIndonesianNumber` / `isDerivableAmount` — including the `\b` after the magnitude-suffix group in **both** regex branches, which is what stops "Rp3.500 kalau" reading as Rp3.500.000. Then add:

```ts
const URL_PATTERN = /https?:\/\/[^\s<>()"']+/gi

/** Trailing punctuation is sentence formatting, not part of the URL. */
export function extractUrls(text: string): string[] {
  return [...((text ?? '').match(URL_PATTERN) ?? [])].map((u) => u.replace(/[.,;:!?)\]]+$/, ''))
}

export function verifyReply(params: {
  replyText: string
  groundedAmounts: number[]
  groundedUrls: string[]
}): VerificationResult {
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
```

- [ ] **Step 4: Run the unit tests**

Run: `npx vitest run src/lib/bot/reply-verifier.test.ts` — expect PASS.

- [ ] **Step 5: Wire it into the orchestrator's final composition**

Replace the tail of `decideAndRespond` (from `const reply = await callLLM(...)` to the `return`) with:

```ts
    // What this specific turn was actually grounded in -- not the whole catalog.
    // A price the model could not have read here is one it made up.
    const groundedAmounts = [
      ...optionPackages.flatMap((p) => p.priceTiers.map((t) => t.priceIdr)),
      ...(pkg.priceIdr !== null ? [pkg.priceIdr] : []),
      ...extractRupiahAmounts(
        [...knowledge.factualLines, ...knowledge.detailLines, ...disclosures, ...pkg.stagingNotes, GENERAL_FAQ_FALLBACK].join('\n')
      ),
    ]
    const groundedUrls = [
      ...optionPackages.map((p) => p.links.details).filter((u): u is string => Boolean(u)),
      ...(pkg.links.details ? [pkg.links.details] : []),
      ...(primaryLink ? [primaryLink] : []),
      ...extractUrls(GENERAL_FAQ_FALLBACK),
    ]

    const history = await fetchRecentHistory(conversationId, inboundText)
    trace.push(
      'Meminta jawaban dari model lokal',
      `Menggunakan model ${settings.ollamaModel} (Ollama, lokal), topik "${resolverTopic}", ${knowledge.factualLines.length} fakta, ${history?.length ?? 0} pesan riwayat.`
    )
    let reply = await callLLM(inboundText, { system, model: settings.ollamaModel, history })
    if (!reply || !reply.trim()) {
      trace.push('Jawaban kosong atau tidak valid', 'Model tidak memberikan jawaban yang bisa dikirim -- tetap dijawab dengan pesan cadangan, bot tetap aktif.')
      return { mode: 'clarify', reply: TECHNICAL_HICCUP_REPLY, steps: trace.steps }
    }

    // GUARDRAIL_INSTRUCTION forbids inventing a price or URL, but nothing ever
    // checked. A wrong price here is the most expensive error this bot can make
    // -- the customer treats it as a quote -- and the link registry has already
    // shipped 18 broken "existing" URLs once (see knowledge.ts). One corrective
    // retry, then a safe deferral: never a fabricated number, never a dead link.
    let verdict = verifyReply({ replyText: reply, groundedAmounts, groundedUrls })
    if (verdict.fabricatedPrices.length > 0 || verdict.unknownUrls.length > 0) {
      trace.push(
        'Verifikasi gagal',
        `Balasan menyebut harga/link yang tidak ada di data: ${[...verdict.fabricatedPrices, ...verdict.unknownUrls].join(', ')} -- model diminta menulis ulang.`
      )
      const retried = await callLLM(inboundText, {
        system: `${system}${buildVerificationRetryInstruction(verdict)}`,
        model: settings.ollamaModel,
        history,
      })
      const retriedVerdict = retried?.trim()
        ? verifyReply({ replyText: retried, groundedAmounts, groundedUrls })
        : null
      if (retried?.trim() && retriedVerdict && retriedVerdict.fabricatedPrices.length === 0 && retriedVerdict.unknownUrls.length === 0) {
        reply = retried
        verdict = retriedVerdict
        trace.push('Penulisan ulang berhasil', 'Balasan kedua hanya memakai harga/link yang benar-benar ada di data.')
      } else {
        // The one handoff this plan adds (see Global Constraints). It is NOT a
        // content gap -- the facts were present and the model would not use
        // them -- so it is the one case where a human genuinely must answer.
        trace.push('Balasan ditahan', 'Penulisan ulang masih mengarang harga/link -- balasan diganti pesan aman dan percakapan diserahkan ke agen.')
        return { mode: 'handoff', reason: 'Balasan gagal verifikasi harga/link dua kali berturut-turut', steps: trace.steps }
      }
    } else if (verdict.unverifiedPrices.length > 0) {
      // Advisory only: a group total is legitimate arithmetic no closed-form
      // check can enumerate, and blocking those would break real quoting.
      trace.push(
        'Harga perlu dicek',
        `Balasan menyebut ${verdict.unverifiedPrices.map((a) => `Rp${a.toLocaleString('id-ID')}`).join(', ')} yang bukan tier langsung dari katalog (mungkin hasil hitungan) -- tetap dikirim.`
      )
    }

    trace.push('Jawaban siap dikirim', previewText(reply))
    return { mode: 'faq', draft: reply, sourceTopic: resolverTopic, steps: trace.steps }
```

Apply the same verification to `runBookingContextMode` and `runNoDestinationBranch`, grounding those on their own facts (`GENERAL_FAQ_FALLBACK` + booking JSON amounts for Mode 3; `preDestinationKnowledge` + `GENERAL_FAQ_FALLBACK` for the no-destination branch). Extract the block into a local `async function composeVerifiedReply(...)` if it reads better than three copies — a reviewer should not have to check three near-identical blocks stayed in sync.

- [ ] **Step 6: Verify and commit**

Run: `npm test` — expect all green. Tests whose mocked `callLLM` returns a reply containing an invented price or URL will now hand off; change those fixtures to quote a real tier from the real catalog, which is what a real reply does.
Run: `npx tsc --noEmit && npx eslint src/lib/bot` — expect clean.

```bash
git add src/lib/bot/reply-verifier.ts src/lib/bot/reply-verifier.test.ts src/lib/bot/orchestrator.ts src/lib/bot/orchestrator.test.ts
git commit -m "Verify prices and links in the reply before sending it

The only post-generation check was that the reply was non-empty; every rule
about not inventing a price or a URL lived in the prompt and was never
enforced. Prices here are per-pax tiers, so the wrong one is a subtle and
expensive error, and the link registry has shipped 18 dead 'existing' URLs
once already. Two severities, because an order summary legitimately sums: a
figure with no grounded price at all is blocked and retried once, a figure
that is merely not derivable is recorded and still sent.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

**Phase 2 gate:** `npm test` green, `tsc` and `eslint` clean. Stop and report before Phase 3.

---

# Phase 3 — Measurement, then consolidation

---

### Task 11: Log knowledge gaps the bot hit

**Why:** the only way anyone has ever learned what the bot cannot answer is a manual audit — the 2026-08-06 read of 870 real messages that produced most of the branches in `orchestrator.ts`. That does not scale and does not repeat. watsapin's `UnansweredQuestionLog` closes the loop automatically; wa-inbox has no equivalent.

Unlike watsapin, this bot returns prose, not an actions array, so the trigger cannot be the model volunteering one. Two signals that need no model cooperation and are both genuinely "we had nothing":

1. `knowledge.factualLines.length === 0` on a topic that is not `greeting`.
2. The reply verifier from Task 10 fired (`fabricatedPrices` or `unknownUrls` non-empty) — the model reached for something that was not there.

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `src/lib/bot/orchestrator.ts`
- Create: `src/app/api/bot/knowledge-gaps/route.ts`
- Create: `src/app/(authenticated)/settings/knowledge-gaps/page.tsx`
- Test: `src/lib/bot/orchestrator.test.ts`

**Interfaces:**
- Consumes: `VerificationResult` from Task 10.
- Produces: Prisma model `KnowledgeGapLog { id, conversationId, topic, reason, messageText, createdAt }` with `reason` one of the string literals `'no_facts_resolved' | 'verification_failed'`.

- [ ] **Step 1: Add the model**

```prisma
// What the bot could not answer, recorded as it happens. Until this existed
// the only way to learn the bot's blind spots was a manual read of the whole
// message history -- the 2026-08-06 audit of 870 messages that produced most
// of orchestrator.ts's branches. That does not repeat and does not scale.
// `reason` is deliberately a small closed set, not free text, so the settings
// page can group by it: 'no_facts_resolved' means the catalog had nothing for
// the classified topic, 'verification_failed' means it had something and the
// model reached past it anyway. Those need opposite fixes.
model KnowledgeGapLog {
  id             String       @id @default(cuid())
  conversationId String
  conversation   Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  topic          String
  reason         String
  messageText    String
  createdAt      DateTime     @default(now())

  @@index([createdAt])
}
```

Add `knowledgeGaps KnowledgeGapLog[]` to `model Conversation`.

Run: `npx prisma generate`. **Do not run `prisma db push`** — the DATABASE_URL points at production. Note in the commit body that the operator must run it before deploying.

- [ ] **Step 2: Write the failing test**

```ts
it('records a knowledge gap when the catalog resolved no facts for the topic', async () => {
  vi.mocked(resolveKnowledgeForTopic).mockReturnValue({
    factualLines: [], detailLines: [], primaryLink: null, disclosures: [], handoffRequired: false,
  })
  await decideAndRespond('conv_1', 'do you offer paragliding over the crater?')
  expect(prismaMock.knowledgeGapLog.create).toHaveBeenCalledWith(
    expect.objectContaining({ data: expect.objectContaining({ reason: 'no_facts_resolved' }) })
  )
})

it('does not record a gap for a plain greeting', async () => {
  vi.mocked(classifyTopicViaLLM).mockResolvedValue({ topic: 'greeting', source: 'llm' })
  vi.mocked(resolveKnowledgeForTopic).mockReturnValue({
    factualLines: [], detailLines: [], primaryLink: null, disclosures: [], handoffRequired: false,
  })
  await decideAndRespond('conv_1', 'halo')
  expect(prismaMock.knowledgeGapLog.create).not.toHaveBeenCalled()
})
```

Add `knowledgeGapLog: { create: vi.fn(), findMany: vi.fn() }` to the Prisma mock.

- [ ] **Step 3: Implement the recorder**

In `orchestrator.ts`, above `decideAndRespond`:

```ts
/**
 * Records something the bot could not answer. Best-effort by design: a failure
 * to write the audit row must never cost the customer their reply, so this
 * swallows and logs rather than propagating into decideAndRespond's outer
 * catch (which would turn a bookkeeping error into TECHNICAL_HICCUP_REPLY).
 */
async function recordKnowledgeGap(
  conversationId: string,
  topic: string,
  reason: 'no_facts_resolved' | 'verification_failed',
  messageText: string
): Promise<void> {
  try {
    await prisma.knowledgeGapLog.create({ data: { conversationId, topic, reason, messageText } })
  } catch (error) {
    console.error('recordKnowledgeGap failed', { conversationId, reason, error })
  }
}
```

Call it in two places, both `void`-ed so they never delay the reply:

```ts
    // 'greeting' resolving to nothing is correct, not a gap -- there was no
    // question to answer.
    if (knowledge.factualLines.length === 0 && resolverTopic !== 'greeting') {
      void recordKnowledgeGap(conversationId, resolverTopic, 'no_facts_resolved', inboundText)
    }
```

and inside Task 10's verification-failed branch, before the handoff return:

```ts
      void recordKnowledgeGap(conversationId, resolverTopic, 'verification_failed', inboundText)
```

- [ ] **Step 4: Build the API route**

Create `src/app/api/bot/knowledge-gaps/route.ts`, mirroring `src/app/api/bot/decisions/route.ts`. Read that file first: it has **no in-route session guard** — it relies on `src/middleware.ts` for auth, like every other route under `/api/bot`. Do not add one here either; a lone guarded route in an otherwise middleware-guarded group is a second pattern, not extra safety.

```ts
export async function GET(request: Request) {
  // ...same session/role guard as /api/bot/decisions...
  const reason = new URL(request.url).searchParams.get('reason') ?? undefined
  const gaps = await prisma.knowledgeGapLog.findMany({
    where: reason ? { reason } : {},
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: { conversation: { include: { contact: true } } },
  })
  return NextResponse.json(
    gaps.map((g) => ({
      id: g.id,
      conversationId: g.conversationId,
      contactName: g.conversation.contact.name,
      topic: g.topic,
      reason: g.reason,
      messageText: g.messageText,
      createdAt: g.createdAt,
    }))
  )
}
```

- [ ] **Step 5: Build the page**

Create `src/app/(authenticated)/settings/knowledge-gaps/page.tsx` modelled directly on `src/app/(authenticated)/settings/bot-log/page.tsx` — same `fetchJson`, same `Card`/`Select` imports, same Indonesian copy register. Title: `Pertanyaan Tak Terjawab`. Filter select: `Semua` / `Tidak ada fakta` (`no_facts_resolved`) / `Gagal verifikasi` (`verification_failed`). Each row shows topic, contact, timestamp and the customer's message. Add a link to it from `src/app/(authenticated)/settings/page.tsx` next to the existing bot-log link.

- [ ] **Step 6: Verify and commit**

Run: `npm test` — expect all green.
Run: `npx tsc --noEmit && npx eslint src` — expect clean.

```bash
git add prisma/schema.prisma src/lib/bot/orchestrator.ts src/lib/bot/orchestrator.test.ts "src/app/api/bot/knowledge-gaps/route.ts" "src/app/(authenticated)/settings/knowledge-gaps/page.tsx" "src/app/(authenticated)/settings/page.tsx"
git commit -m "Record what the bot could not answer

The only way anyone has learned this bot's blind spots was a manual read of
870 real messages, which produced most of the branches in orchestrator.ts and
which nobody is going to repeat monthly. Two signals that need no cooperation
from the model: the catalog resolving no facts for a classified topic, and
the reply verifier catching the model reaching for something that was not
there. Those need opposite fixes, so reason is a closed set the page groups
by rather than free text.

Requires \`npx prisma db push\` against the production database before deploy.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: A golden-set evaluation harness

**Why:** The existing tests verify *routing* — which mode, which facts entered the prompt, which tier was picked — because `callLLM` is mocked everywhere. Not one of them looks at the text actually sent to a customer. `orchestrator.real.test.ts`'s own header admits four real parsing bugs had to be found by live-testing after deploy. There is currently no way to answer "did that change make answers better?" with a number.

This harness runs the **real** orchestrator against the **real** Ollama, over conversations taken from the real customer messages already documented in the code comments, and scores each one.

**Files:**
- Create: `src/lib/bot/eval/fixtures.ts`
- Create: `src/lib/bot/eval/run-eval.ts`
- Modify: `package.json` (add `"eval": "tsx src/lib/bot/eval/run-eval.ts"`)
- Test: `src/lib/bot/eval/fixtures.test.ts`

**Interfaces:**
- Consumes: `decideAndRespond`, `verifyReply` (Task 10).
- Produces:

```ts
export type EvalCase = {
  id: string
  /** Each turn is one inbound message, replayed in order against one conversation. */
  turns: string[]
  /** Lowercased substrings that MUST all appear in the final reply. */
  mustContain: string[]
  /** Lowercased substrings that must NOT appear. */
  mustNotContain: string[]
  /** Where this case came from, so a failure can be argued about against a real message. */
  source: string
}
export const EVAL_CASES: EvalCase[]
```

- [ ] **Step 1: Write the fixtures**

Create `src/lib/bot/eval/fixtures.ts`. Every case must be a real customer message already documented in a code comment — cite the file and date in `source`. Seed with at least these twelve, drawn from comments in `orchestrator.ts`, `knowledge.ts`, `module-resolver.ts` and `types.ts`:

```ts
export const EVAL_CASES: EvalCase[] = [
  {
    id: 'deposit-amount',
    turns: ['how much is the deposit and when do I pay?'],
    mustContain: ['20%'],
    mustNotContain: ["don't have", 'not sure'],
    source: 'module-resolver.ts, live-tested 2026-08-04 (classified as price, whose modules have no deposit content)',
  },
  {
    id: 'dietary-no-beef',
    turns: ["please make sure her meals don't contain beef"],
    mustContain: ['noted'],
    mustNotContain: ['where would you like to go'],
    source: 'knowledge.ts KEYWORD_TRIGGERED_MODULES, reported 2026-08-05 (stonewalled with a destination question)',
  },
  {
    id: 'finish-in-bali',
    turns: ['3 day trip from Bali to Ijen', 'can we finish the trip in Bali?'],
    mustContain: [],
    mustNotContain: ['yes, all of them', 'every package'],
    source: 'types.ts CatalogPackage.finishCities, 2026-08-05 (answered from origin instead of dropoff options)',
  },
  {
    id: 'solo-traveller-price',
    turns: ['what is the price for the 3 day bromo ijen tour from bali for 1 person?'],
    mustContain: ['7.500.000'],
    mustNotContain: ['4.050.000'],
    source: 'types.ts CatalogPackage.priceTiers, 2026-08-05 (11+ pax tier quoted to a solo traveller)',
  },
  {
    id: 'gas-mask-included',
    turns: ['is a gas mask included for ijen?'],
    mustContain: ['included'],
    mustNotContain: ['let me check'],
    source: 'knowledge.ts resolveKnowledgeForTopic, reported 2026-08-04',
  },
  {
    id: 'blue-fire-guarantee',
    turns: ['blue fire is why we are coming, can you guarantee it 100%?'],
    mustContain: ['cannot be guaranteed'],
    mustNotContain: ['yes, guaranteed', 'we guarantee'],
    source: 'knowledge.ts GUARDRAIL_INSTRUCTION + ATTRACTION_TRIGGER_PHRASES',
  },
  {
    id: 'yogyakarta-pickup',
    turns: ['Start / Pick-up: Yogyakarta. What is the price for 2 people?'],
    mustContain: ['surabaya'],
    mustNotContain: [],
    source: 'orchestrator.ts mentionedUnsupportedOriginCity, reported 2026-08-06',
  },
  {
    id: 'cancellation-options',
    turns: ['What are my options if I have to cancel due to a flight delay?'],
    mustContain: [],
    mustNotContain: ['could you share a few details', 'number of day'],
    source: 'orchestrator.ts DESTINATION_INDEPENDENT_TOPICS, audit 2026-08-07 (bare "options" derailed it into the funnel)',
  },
  {
    id: 'insurance-advice',
    turns: ['would you recommend that we buy our own travel insurance?'],
    mustContain: [],
    mustNotContain: ['could you share a few details'],
    source: 'orchestrator.ts RECOMMENDATION_VERB_PATTERN, reported 2026-08-05',
  },
  {
    id: 'travel-time-surabaya-bromo',
    turns: ['how many hours from surabaya to bromo?'],
    mustContain: ['hour'],
    mustNotContain: ['let me check'],
    source: 'knowledge.ts resolveRouteLegFacts, message audit 2026-08-06',
  },
  {
    id: 'hotel-names',
    turns: ['which hotel do we stay at on the 3 day bromo ijen tour from bali?'],
    mustContain: ['joglo kecombrang'],
    mustNotContain: ['check the package page'],
    source: 'Task 8 of this plan — accommodation-rules.json was never read',
  },
  {
    id: 'ijen-monthly-closure',
    turns: ['is ijen open on the first friday of the month?'],
    mustContain: ['closed'],
    mustNotContain: ['yes, open every day'],
    source: 'Task 7 of this plan — policy_ijen_monthly_closure was unreachable',
  },
]
```

- [ ] **Step 2: Write the fixture test**

Create `src/lib/bot/eval/fixtures.test.ts`. This runs in the normal suite and needs no Ollama:

```ts
it('every case cites where it came from and asserts something', () => {
  for (const c of EVAL_CASES) {
    expect(c.source, `${c.id} has no source`).toMatch(/\d{4}-\d{2}-\d{2}|this plan/)
    expect(c.mustContain.length + c.mustNotContain.length, `${c.id} asserts nothing`).toBeGreaterThan(0)
  }
})

it('uses lowercase assertions, since the runner lowercases the reply', () => {
  for (const c of EVAL_CASES) {
    for (const s of [...c.mustContain, ...c.mustNotContain]) expect(s).toBe(s.toLowerCase())
  }
})

it('has unique ids', () => {
  expect(new Set(EVAL_CASES.map((c) => c.id)).size).toBe(EVAL_CASES.length)
})
```

- [ ] **Step 3: Write the runner**

Create `src/lib/bot/eval/run-eval.ts`. It is a **script**, not a vitest file — it calls the real Ollama and the real DB, so it must never run inside `npm test`:

```ts
#!/usr/bin/env tsx
/**
 * Scores the bot's ACTUAL replies against real customer messages.
 *
 * The existing test suite verifies routing -- which mode, which facts entered the
 * prompt -- because callLLM is mocked in all of it. Nothing checks the text a
 * customer receives, which is why orchestrator.real.test.ts's own header
 * records four real parsing bugs that had to be found by live-testing after
 * deploy. This is the missing layer.
 *
 * Run deliberately: `npm run eval`. It needs a reachable Ollama and a database,
 * creates its own throwaway conversations against a sentinel phone number, and
 * deletes them afterwards. It never sends a WhatsApp message -- decideAndRespond
 * only RETURNS a decision; dispatch happens in inbound.ts, which this never calls.
 */
```

Then the body. Note there is deliberately no separate fabrication check here: as of Task 10 a fabricated price or link already becomes a `handoff` inside the orchestrator, which this scores as a failure — re-deriving the grounding out here would be a second, drifting copy of it.

```ts
import { prisma } from '@/lib/db'
import { decideAndRespond } from '../orchestrator'
import { EVAL_CASES, type EvalCase } from './fixtures'

type CaseResult = { id: string; passed: boolean; detail: string; reply: string }

async function runCase(c: EvalCase): Promise<CaseResult> {
  const phone = `eval-${c.id}`
  const contact = await prisma.contact.upsert({
    where: { phone },
    update: {},
    create: { phone, name: `eval ${c.id}` },
  })
  const conversation = await prisma.conversation.upsert({
    where: { contactId: contact.id },
    update: { tripBrief: {}, botEnabled: true },
    create: { contactId: contact.id, botEnabled: true, isTest: true, tripBrief: {} },
  })

  let reply = ''
  let detail = ''
  for (const turn of c.turns) {
    const decision = await decideAndRespond(conversation.id, turn)
    if (decision.mode === 'handoff') return { id: c.id, passed: false, detail: `handoff: ${decision.reason}`, reply: '' }
    reply = decision.mode === 'faq' ? decision.draft : decision.reply
  }

  const low = reply.toLowerCase()
  const missing = c.mustContain.filter((s) => !low.includes(s))
  const present = c.mustNotContain.filter((s) => low.includes(s))
  if (missing.length > 0) detail = `missing: ${missing.join(', ')}`
  if (present.length > 0) detail += `${detail ? '; ' : ''}forbidden: ${present.join(', ')}`
  return { id: c.id, passed: missing.length === 0 && present.length === 0, detail: detail || 'ok', reply }
}

async function cleanup(): Promise<void> {
  // Deleting the contact cascades to its conversation and messages. Scoped by
  // the `eval-` prefix so it can never touch a real customer row.
  await prisma.contact.deleteMany({ where: { phone: { startsWith: 'eval-' } } })
}

async function main(): Promise<void> {
  const results: CaseResult[] = []
  try {
    for (const c of EVAL_CASES) results.push(await runCase(c))
  } finally {
    await cleanup()
  }

  for (const r of results) {
    console.log(`${r.passed ? 'PASS' : 'FAIL'}  ${r.id.padEnd(28)} ${r.detail}`)
    if (!r.passed && r.reply) console.log(`      reply: ${r.reply.replace(/\n/g, ' ').slice(0, 200)}`)
  }
  const passed = results.filter((r) => r.passed).length
  const rate = Math.round((passed / results.length) * 100)
  console.log(`\nPASS ${passed}/${results.length} (${rate}%)`)

  // BASELINE is recorded by the operator after the first run and raised only
  // deliberately. Exiting non-zero below it is what lets this gate a deploy
  // later without anyone having to remember to read the output.
  const baseline = Number(process.env.EVAL_BASELINE ?? '0')
  if (rate < baseline) {
    console.error(`Regression: ${rate}% is below the recorded baseline of ${baseline}%`)
    process.exit(1)
  }
}

void main()
```

- [ ] **Step 4: Wire the script**

In `package.json` scripts: `"eval": "tsx src/lib/bot/eval/run-eval.ts"`.

- [ ] **Step 5: Verify what can be verified here**

Run: `npx vitest run src/lib/bot/eval/fixtures.test.ts` — expect PASS.
Run: `npm test` — expect all green.
Run: `npx tsc --noEmit && npx eslint src/lib/bot/eval` — expect clean.

**Do not run `npm run eval` yourself.** It calls the live Ollama and writes to the production database. Report to the operator that it is ready and let them run it and record the baseline.

- [ ] **Step 6: Commit**

```bash
git add src/lib/bot/eval package.json
git commit -m "Add a golden-set evaluation harness for real replies

Every one of the the existing tests mocks callLLM, so the suite verifies
routing and never once looks at the text a customer receives -- which is why
orchestrator.real.test.ts records four parsing bugs that had to be found by
live-testing after deploy. This scores the real orchestrator against real
Ollama over twelve messages real customers actually sent, each one cited back
to the code comment that documents it. Kept out of npm test deliberately: it
needs a live model, so it is a script the operator runs to record a baseline.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: Collapse the classifier batch into one call

**Why:** Task 6 made the six classifiers concurrent, which fixed latency. It did not fix the other half: each one still judges the same message in isolation, with no shared context, and they can contradict each other. One structured call returning all six verdicts is cheaper, more coherent, and removes six independent prompt surfaces.

**This task must not start until Task 12's baseline has been recorded by the operator.** Its entire justification is that answers get no worse, and without a number that is an opinion. If the baseline does not exist, stop and say so.

**Files:**
- Create: `src/lib/bot/unified-classifier.ts`
- Modify: `src/lib/bot/orchestrator.ts`
- Test: `src/lib/bot/unified-classifier.test.ts`

**Interfaces:**
- Consumes: `classifyTopicViaLLM`, `classifyKeywordModulesViaLLM`, `extractTripPreferences`, `detectsPreferenceDeclineViaLLM`, `detectsRecommendationIntentViaLLM` — each kept, unchanged, as this task's per-field fallback.
- Produces:

```ts
export type UnifiedClassification = {
  topic: ResolverTopic
  keywordModuleIds: string[]
  preferences: TripPreferences
  declined: boolean
  isRecommendation: boolean
  /** Which fields came from the single call vs. fell back to their own classifier. */
  sources: Record<'topic' | 'keywordModules' | 'preferences' | 'declined' | 'isRecommendation', 'unified' | 'fallback'>
}
export async function classifyUnified(params: {
  message: string
  job: string | null | undefined
  model: string
}): Promise<UnifiedClassification>
```

- [ ] **Step 1: Write the failing test**

```ts
it('parses all five verdicts from one call', async () => {
  vi.mocked(callLLM).mockResolvedValue(JSON.stringify({
    topic: 'price', keywordModuleIds: [], declined: false, isRecommendation: true,
    preferences: { origin: 'Surabaya', dayCount: 3, finishCity: 'bali', pax: 2 },
  }))
  const r = await classifyUnified({ message: '3 day surabaya to bali for 2, which package?', job: 'J2', model: 'm' })
  expect(r.topic).toBe('price')
  expect(r.preferences.dayCount).toBe(3)
  expect(r.isRecommendation).toBe(true)
  expect(callLLM).toHaveBeenCalledTimes(1)
})

it('falls back per field, not all-or-nothing, when one field is invalid', async () => {
  // A bad topic must not discard a perfectly good preferences object.
  vi.mocked(callLLM).mockResolvedValue(JSON.stringify({
    topic: 'not-a-real-topic', keywordModuleIds: [], declined: false, isRecommendation: false,
    preferences: { origin: 'Surabaya', dayCount: 3, finishCity: null, pax: null },
  }))
  vi.mocked(classifyTopicViaLLM).mockResolvedValue({ topic: 'general', source: 'llm' })
  const r = await classifyUnified({ message: 'x', job: null, model: 'm' })
  expect(r.topic).toBe('general')
  expect(r.sources.topic).toBe('fallback')
  expect(r.preferences.origin).toBe('Surabaya')
  expect(r.sources.preferences).toBe('unified')
})

it('falls back on every field when the call fails entirely', async () => {
  vi.mocked(callLLM).mockRejectedValue(new Error('timeout'))
  const r = await classifyUnified({ message: 'x', job: null, model: 'm' })
  expect(Object.values(r.sources).every((s) => s === 'fallback')).toBe(true)
})
```

- [ ] **Step 2: Run and watch fail**

Run: `npx vitest run src/lib/bot/unified-classifier.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import { z } from 'zod'
import { callLLM } from './llm'
import { VALID_TOPIC_LIST, type ResolverTopic } from './module-resolver'
import { KEYWORD_TRIGGERED_MODULES } from './knowledge'
import type { TripPreferences } from './package-match'

const KNOWN_MODULE_IDS = new Set(KEYWORD_TRIGGERED_MODULES.map((m) => m.moduleId))
const SENTINEL = '__invalid__'

// Every field is `.catch()`ed INDIVIDUALLY, mirroring watsapin's
// botEngineResponseSchema: a hallucinated topic must never discard a correct
// preferences object. A sentinel rather than a plausible default is what lets
// the caller tell "the model said 'general'" apart from "the model said
// something that is not a topic at all" -- only the second should fall back.
const unifiedSchema = z.object({
  topic: z.enum(VALID_TOPIC_LIST).catch(SENTINEL as never),
  keywordModuleIds: z.array(z.string()).catch([SENTINEL]),
  declined: z.boolean().catch(null as never),
  isRecommendation: z.boolean().catch(null as never),
  preferences: z
    .object({
      origin: z.enum(['Surabaya', 'Bali']).nullable().catch(null),
      dayCount: z.number().int().min(1).max(14).nullable().catch(null),
      finishCity: z.enum(['bali', 'surabaya', 'malang', 'ketapang']).nullable().catch(null),
      pax: z.number().int().min(1).max(60).nullable().catch(null),
    })
    .catch(null as never),
})

const UNIFIED_SYSTEM_PROMPT = `You read ONE WhatsApp message from a customer to a private tour operator (JVTO) in East Java, Indonesia, and report five things about it at once. Judge what the message MEANS, not which literal words it contains.

1. "topic": exactly one of ${VALID_TOPIC_LIST.join(', ')}.
2. "keywordModuleIds": which independent fact triggers the message calls for, from this list only: ${KEYWORD_TRIGGERED_MODULES.map((m) => `${m.moduleId} (${m.description})`).join('; ')}. Empty array if none apply.
3. "preferences": the trip details the customer states IN THIS MESSAGE. origin is "Surabaya" or "Bali" (where the trip STARTS) or null. finishCity is "bali", "surabaya", "malang" or "ketapang" (where it ENDS) or null. dayCount is the trip length in days or null. pax is the number of travellers or null. Never guess -- null means they did not say it.
4. "declined": true only if they explicitly say they do not know or do not mind about their start/finish/trip length (e.g. "gak tau", "terserah", "you decide"). A "whatever" about something unrelated is NOT this.
5. "isRecommendation": true if they are asking for help CHOOSING a tour package. A message containing "options" or "recommend" about something else (cancellation options, travel-insurance advice) is NOT this.

Reply with ONLY valid JSON, no markdown, exactly this shape:
{"topic":"...","keywordModuleIds":[],"preferences":{"origin":null,"dayCount":null,"finishCity":null,"pax":null},"declined":false,"isRecommendation":false}

Examples:

Message: "3 day trip from Surabaya finishing in Bali for 2 people, which package do you suggest?"
Output: {"topic":"price","keywordModuleIds":[],"preferences":{"origin":"Surabaya","dayCount":3,"finishCity":"bali","pax":2},"declined":false,"isRecommendation":true}

Message: "What are my options if I have to cancel due to a flight delay?"
Output: {"topic":"cancellation","keywordModuleIds":[],"preferences":{"origin":null,"dayCount":null,"finishCity":null,"pax":null},"declined":false,"isRecommendation":false}`

function stripCodeFence(raw: string): string {
  return raw.trim().replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '')
}

export async function classifyUnified(params: {
  message: string
  job: string | null | undefined
  model: string
}): Promise<UnifiedClassification> {
  const { message, job, model } = params
  let parsed: z.infer<typeof unifiedSchema> | null = null
  try {
    parsed = unifiedSchema.parse(JSON.parse(stripCodeFence(await callLLM(message, { system: UNIFIED_SYSTEM_PROMPT, model }))))
  } catch (err) {
    console.error('unified classification failed', { error: err })
  }

  const topicOk = parsed !== null && (parsed.topic as string) !== SENTINEL
  const modulesOk = parsed !== null && !parsed.keywordModuleIds.includes(SENTINEL)
  const prefsOk = parsed !== null && parsed.preferences !== null
  const declinedOk = parsed !== null && typeof parsed.declined === 'boolean'
  const recoOk = parsed !== null && typeof parsed.isRecommendation === 'boolean'

  // Only the fields that actually failed pay for a fallback, and they pay in
  // parallel -- so a partly-bad response costs one extra round trip, not five.
  const [topicFb, modulesFb, prefsFb, declinedFb, recoFb] = await Promise.all([
    topicOk ? null : classifyTopicViaLLM(job, message, model),
    modulesOk ? null : classifyKeywordModulesViaLLM(message, model),
    prefsOk ? null : extractTripPreferences(message, model),
    declinedOk ? null : detectsPreferenceDeclineViaLLM(message, isUnknownPreferenceSignal, model),
    recoOk ? null : detectsRecommendationIntentViaLLM(message, isRecommendationRequest, model),
  ])

  return {
    topic: topicOk ? (parsed!.topic as ResolverTopic) : topicFb!.topic,
    // An unknown module id is dropped, never trusted: the id set is fixed, and a
    // hallucinated one would otherwise resolve to no module at all, silently.
    keywordModuleIds: modulesOk ? parsed!.keywordModuleIds.filter((id) => KNOWN_MODULE_IDS.has(id)) : modulesFb!.moduleIds,
    preferences: prefsOk ? (parsed!.preferences as TripPreferences) : prefsFb!.preferences,
    declined: declinedOk ? parsed!.declined : declinedFb!.declined,
    isRecommendation: recoOk ? parsed!.isRecommendation : recoFb!.isRecommendation,
    sources: {
      topic: topicOk ? 'unified' : 'fallback',
      keywordModules: modulesOk ? 'unified' : 'fallback',
      preferences: prefsOk ? 'unified' : 'fallback',
      declined: declinedOk ? 'unified' : 'fallback',
      isRecommendation: recoOk ? 'unified' : 'fallback',
    },
  }
}
```

`isUnknownPreferenceSignal` and `isRecommendationRequest` are currently private to `orchestrator.ts` — export them from there (both are pure functions with no dependencies) rather than duplicating either keyword list. `VALID_TOPIC_LIST` does not exist yet: add it to `module-resolver.ts` as `export const VALID_TOPIC_LIST = [...] as const satisfies readonly ResolverTopic[]` covering the same 14 names `TOPIC_KEYWORDS` already uses, and rebuild `topic-classifier.ts`'s existing `VALID_TOPICS` set from it so the two lists can never drift.

- [ ] **Step 4: Swap it in**

Replace Task 6's five-way `Promise.all` in the destination-known branch with a single `classifyUnified(...)`. Keep the two-way batch in the no-destination branch as-is — it needs two of the five and a unified call would be strictly more tokens for less. Map `sources` into the existing `trace.push` lines so the bot log still says, per field, whether the model or the fallback answered.

- [ ] **Step 5: Verify against the baseline**

Run: `npm test` — expect all green.
Run: `npx tsc --noEmit && npx eslint src/lib/bot` — expect clean.

Then hand back to the operator: they run `npm run eval` and compare with the Task 12 baseline. **If the pass rate drops, revert this task** — the single call is an optimisation, and it is not worth a worse answer. Say this plainly rather than tuning the prompt until the number recovers.

- [ ] **Step 6: Commit**

```bash
git add src/lib/bot/unified-classifier.ts src/lib/bot/unified-classifier.test.ts src/lib/bot/orchestrator.ts
git commit -m "Collapse five classifiers into one structured call

Running them concurrently fixed latency but not coherence: each still judged
the same message in isolation and they could contradict each other. One JSON
call returns all five verdicts with shared context. Validation is per field,
not all-or-nothing -- a hallucinated topic must not discard a correct
preferences object -- and each failed field falls back to the classifier it
replaced, all five in parallel so a bad response costs one extra round trip
rather than five.

Verified against the golden-set baseline from the evaluation harness; this
change is an optimisation and must be reverted if that number drops.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Deployment

None of this reaches production automatically. After all phases are green:

1. `npx prisma migrate deploy` against the production database (applies the `add_knowledge_gap_log` migration, Task 11's `KnowledgeGapLog`). Must happen **before** the code lands, or every gap write fails into the orchestrator's catch and degrades the reply.
2. Deploy per the repo's existing rsync procedure — and per the standing note, **exclude `catalog/deployment-approval.json`**, which lives only on the VPS and is gitignored. Deleting it silently closes the bot gate.
3. `npm run eval` on the server to record the post-deploy baseline.
