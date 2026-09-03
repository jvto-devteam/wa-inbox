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

async function cleanup(): Promise<void> {
  // Deleting the contact cascades to its conversation and messages. Scoped by
  // the `eval-` prefix so it can never touch a real customer row.
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
