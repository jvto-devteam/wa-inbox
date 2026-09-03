// Cost/abuse guard for the bot brain. Every message that reaches
// decideAndRespond costs up to eight Ollama calls across four sequential
// waits (see orchestrator.ts's header: the escalation LLM signal, the
// five-way parallel classifier batch, the initial composed reply, and
// Task 10's one corrective verification retry), so a customer -- or an
// attacker -- messaging in a tight loop would otherwise burn budget with no
// ceiling at all. Ported from watsapin's lib/bot-engine/rate-limiter.ts.
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
