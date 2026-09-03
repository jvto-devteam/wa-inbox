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
 *
 * There is deliberately no separate fabrication check here: as of Task 10 a
 * fabricated price or link already becomes a `mode: 'handoff'` inside the
 * orchestrator (reply-verifier.ts), which runCase below already scores as a
 * failure -- re-deriving that grounding out here would be a second, drifting
 * copy of it.
 *
 * Deployment gate: Mode 1/2 replies are built from the catalog release, which
 * stays off for customer traffic until an operator runs `npm run
 * approve:deployment` (see deployment-gate.ts's checkDeploymentGate -- there is
 * no `catalog/deployment-approval.json` in a fresh checkout, since it's a
 * VPS-only, gitignored file an operator mints). If the gate is closed, EVERY
 * Mode 1/2 case here would come back `mode: 'handoff'` before any knowledge
 * resolution even runs -- reporting that as "PASS 0/12 (0%)" would read as "the
 * bot is broken" when the truth is "this release isn't approved for customer
 * traffic here". So the gate is checked once, up front, before any case runs,
 * and a closed gate exits honestly instead of producing a misleading score.
 *
 * The top-level `main()` invocation at the bottom is guarded by `!process.env.VITEST` --
 * Vitest sets that env var for every test process, so run-eval.test.ts can import `cleanup`
 * from this module (to test its deletion order against a mocked prisma, no real database)
 * without that import ever firing `main()`, touching a real database, or calling
 * `process.exit`.
 */
import { prisma } from '@/lib/db'
import { checkDeploymentGate } from '../deployment-gate'
import { decideAndRespond } from '../orchestrator'
import { EVAL_CASES, type EvalCase } from './fixtures'

// Distinct from the regression exit code (1) below, so a CI wiring can tell "not approved to
// run here" apart from "quality regressed" without parsing stdout.
const EXIT_GATE_CLOSED = 3

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

// Exported for run-eval.test.ts, which asserts the deletion order and scoping against a
// mocked prisma (no real database, no Ollama) -- see that file's header for why this needed
// its own regression test.
export async function cleanup(): Promise<void> {
  // NOT a cascade. `Contact <--RESTRICT-- Conversation <--RESTRICT-- Message` (see
  // prisma/migrations/20260727013701_init/migration.sql:194 and :200): this schema uses real
  // Postgres foreign keys, not Prisma-emulated ones (`relationMode` is unset in schema.prisma,
  // which defaults to "foreignKeys"), and neither FK cascades. Deleting a Contact while its
  // Conversation still exists -- or a Conversation while a Message referencing it still
  // exists -- aborts the WHOLE delete statement atomically; Prisma throws and zero rows are
  // removed. So this must delete leaves of the dependency tree first: Message, then
  // Conversation, then Contact.
  //
  // decideAndRespond (all `runCase` above ever calls) never itself creates a Message, Note,
  // or Reminder row -- `Message.create` only happens in inbound.ts and send.ts, neither of
  // which this runner calls -- so the Message delete below is defensive, not load-bearing
  // today. Note/Reminder both also reference Contact with the same RESTRICT behavior, but
  // nothing this script does can ever create one, so they're deliberately left alone.
  //
  // All three are independently scoped to the literal `eval-` phone prefix (never inferred
  // from IDs collected during this run), so a partial/crashed run can never leave a stray
  // WHERE clause wide enough to touch a real customer's rows.
  await prisma.message.deleteMany({ where: { conversation: { contact: { phone: { startsWith: 'eval-' } } } } })
  await prisma.conversation.deleteMany({ where: { contact: { phone: { startsWith: 'eval-' } } } })
  await prisma.contact.deleteMany({ where: { phone: { startsWith: 'eval-' } } })
}

async function main(): Promise<void> {
  // Checked ONCE, up front, before any case runs -- see this file's header. A closed gate
  // means every Mode 1/2 case would hit `decideAndRespond`'s own gate branch and come back
  // `mode: 'handoff'` regardless of what the case is testing, which runCase would then score
  // as a failure indistinguishable from a real quality regression. Reporting that as a pass
  // rate would be actively misleading, so this exits before scoring anything.
  const gate = checkDeploymentGate()
  if (!gate.readyForApproval) {
    console.error('Deployment gate is CLOSED -- refusing to run the eval, since every case would score as a false failure.')
    console.error('')
    console.error('checkDeploymentGate() (src/lib/bot/deployment-gate.ts) reports:')
    for (const reason of gate.blocking) console.error(`  - ${reason}`)
    console.error('')
    console.error('This is expected on a fresh checkout: catalog/deployment-approval.json is a VPS-only,')
    console.error('gitignored file an operator mints, and does not exist here.')
    console.error('')
    console.error('To evaluate against a real, approved release, run: npm run approve:deployment -- --approved-by "Nama Anda"')
    console.error('then re-run: npm run eval')
    process.exit(EXIT_GATE_CLOSED)
  }

  const results: CaseResult[] = []
  try {
    for (const c of EVAL_CASES) results.push(await runCase(c))
  } catch (error) {
    // A case being SCORED a failure never throws -- that comes back as an ordinary
    // CaseResult from runCase. A throw here means the harness itself broke mid-run (a
    // network blip, a real bug). Caught, not left to propagate, so whatever results were
    // already collected still get printed below and cleanup still runs -- a crash on case
    // #9 must not silently discard the report for cases #1-8, nor skip removing their rows.
    console.error(`\nrun-eval crashed after ${results.length}/${EVAL_CASES.length} case(s) completed:`, error)
  }

  // Printed BEFORE cleanup, deliberately: a cleanup failure below (or the crash above) must
  // never be able to swallow the one thing this whole script exists to produce.
  for (const r of results) {
    console.log(`${r.passed ? 'PASS' : 'FAIL'}  ${r.id.padEnd(28)} ${r.detail}`)
    if (!r.passed && r.reply) console.log(`      reply: ${r.reply.replace(/\n/g, ' ').slice(0, 200)}`)
  }
  const passed = results.filter((r) => r.passed).length
  const rate = results.length > 0 ? Math.round((passed / results.length) * 100) : 0
  console.log(`\nPASS ${passed}/${results.length} (${rate}%)`)
  const incomplete = results.length < EVAL_CASES.length
  if (incomplete) {
    console.error(`INCOMPLETE: only ${results.length}/${EVAL_CASES.length} cases ran (see the crash above) -- this is not a real score, do not compare it to the baseline.`)
  }

  try {
    await cleanup()
  } catch (error) {
    // Never let this exception propagate past here: the report above has already printed,
    // and it must survive even though the rows this run created are now stuck. Logged loudly
    // enough that an operator can remove them by hand rather than them silently accumulating
    // and breaking every later run's `upsert` (which would re-use, not recreate, them).
    console.error(
      "\nCleanup FAILED -- leftover eval- rows were NOT removed. Remove them by hand, in this order (Message, then Conversation, then Contact -- the FKs are RESTRICT, not CASCADE, see cleanup()'s own comment):"
    )
    console.error(`  DELETE FROM "Message" USING "Conversation" c, "Contact" ct WHERE "Message"."conversationId" = c.id AND c."contactId" = ct.id AND ct.phone LIKE 'eval-%';`)
    console.error(`  DELETE FROM "Conversation" USING "Contact" ct WHERE "Conversation"."contactId" = ct.id AND ct.phone LIKE 'eval-%';`)
    console.error(`  DELETE FROM "Contact" WHERE phone LIKE 'eval-%';`)
    console.error(error)
  }

  if (incomplete) process.exit(1)

  // BASELINE is recorded by the operator after the first run and raised only
  // deliberately. Exiting non-zero below it is what lets this gate a deploy
  // later without anyone having to remember to read the output.
  const baseline = Number(process.env.EVAL_BASELINE ?? '0')
  if (rate < baseline) {
    console.error(`Regression: ${rate}% is below the recorded baseline of ${baseline}%`)
    process.exit(1)
  }
}

// Guarded so importing this module (run-eval.test.ts does, to unit-test `cleanup`'s ordering
// against a mocked prisma) can never accidentally fire `main()` -- see this file's header.
if (!process.env.VITEST) {
  main().catch((error) => {
    // Belt-and-suspenders: every await inside main() that can throw is already handled above
    // (the case loop, cleanup), but this still catches anything outside those -- e.g.
    // checkDeploymentGate() itself throwing -- so the process always exits with a clear
    // message and a non-zero code instead of an unhandled rejection.
    console.error('run-eval crashed unexpectedly:', error)
    process.exit(1)
  })
}
