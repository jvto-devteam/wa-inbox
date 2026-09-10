/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import {
  recordBotDecisionRun,
  attachMessageToDecisionRun,
  statusForDecision,
  replyTextForDecision,
  knowledgeRefsForDecision,
  verificationForDecision,
  topicForDecision,
  jobForDecision,
} from './decision-recorder'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

const startedAt = new Date('2026-09-05T03:00:00.000Z')
const finishedAt = new Date('2026-09-05T03:00:02.500Z')

function createdData() {
  return mockPrisma.botDecisionRun.create.mock.calls[0][0].data
}

beforeEach(() => {
  mockReset(mockPrisma)
  vi.clearAllMocks()
  mockPrisma.botDecisionRun.create.mockResolvedValue({ id: 'run_1' } as never)
})

describe('statusForDecision', () => {
  it('maps every mode the guidebook specifies', () => {
    expect(statusForDecision({ mode: 'faq' })).toBe('REPLIED')
    expect(statusForDecision({ mode: 'booking_context' })).toBe('REPLIED')
    expect(statusForDecision({ mode: 'clarify' })).toBe('CLARIFIED')
    expect(statusForDecision({ mode: 'handoff' })).toBe('HANDOFF')
  })

  it('treats an exception as FAILED even when a partial decision exists', () => {
    expect(statusForDecision({ mode: 'faq' }, { error: 'boom' })).toBe('FAILED')
  })

  it('treats a deliberately skipped turn as SKIPPED', () => {
    expect(statusForDecision(null, { skipped: true })).toBe('SKIPPED')
  })

  it('ranks an error above a skip', () => {
    expect(statusForDecision(null, { error: 'boom', skipped: true })).toBe('FAILED')
  })

  it('calls an unknown mode FAILED rather than claiming the customer was replied to', () => {
    expect(statusForDecision({ mode: 'brand_new_mode' })).toBe('FAILED')
    expect(statusForDecision(null)).toBe('FAILED')
    expect(statusForDecision('not an object')).toBe('FAILED')
  })
})

describe('replyTextForDecision', () => {
  it('reads whichever field of the decision union carries the text', () => {
    expect(replyTextForDecision({ mode: 'faq', draft: 'Isi FAQ' })).toBe('Isi FAQ')
    expect(replyTextForDecision({ mode: 'clarify', reply: 'Tujuannya ke mana?' })).toBe('Tujuannya ke mana?')
  })

  it('returns null for a handoff, which carries a reason rather than a reply', () => {
    expect(replyTextForDecision({ mode: 'handoff', reason: 'Minta manusia' })).toBeNull()
  })
})

describe('knowledgeRefsForDecision', () => {
  it('records the source topic when the decision names one', () => {
    expect(knowledgeRefsForDecision({ mode: 'faq', sourceTopic: 'inclusions' })).toEqual({ sourceTopic: 'inclusions' })
  })

  it('returns undefined rather than inventing references the bot never reported', () => {
    expect(knowledgeRefsForDecision({ mode: 'handoff' })).toBeUndefined()
  })

  // Task 17 (Ruling R54): `decision.knowledge` (catalogLines/managedLines/rejected/gateBypassed,
  // orchestrator.ts's single attachment point) rides alongside sourceTopic in the same Json
  // column -- both facts belong to "what was this decision grounded in", and a decision that
  // still only carries sourceTopic (an older shape, or one Task 17 never touches) must keep
  // producing exactly what it did before this task.
  it('includes decision.knowledge alongside sourceTopic when the decision carries one', () => {
    const knowledge = {
      catalogLines: ['Every package includes private transport.'],
      managedLines: [{ line: 'Berapa deposit? — 20%.', source: 'Kebijakan Pembayaran (v3)' }],
      rejected: [{ sourceKey: 'managed/route', itemQuestion: 'Bisa selesai di Malang?', reason: 'topik [route_endpoint] tidak memuat payment' }],
      gateBypassed: false,
    }
    expect(knowledgeRefsForDecision({ mode: 'faq', sourceTopic: 'payment', knowledge })).toEqual({
      sourceTopic: 'payment',
      knowledge,
    })
  })

  it('includes decision.knowledge alone when the decision has no sourceTopic', () => {
    const knowledge = { catalogLines: [], managedLines: [], rejected: [], gateBypassed: true }
    expect(knowledgeRefsForDecision({ mode: 'clarify', knowledge })).toEqual({ knowledge })
  })
})

describe('recordBotDecisionRun', () => {
  const base = { conversationId: 'conv_1', inboundText: 'berapa harga ijen?', startedAt, finishedAt }

  it('stores mode, status, reply and latency for a normal reply', async () => {
    const id = await recordBotDecisionRun({ ...base, decision: { mode: 'faq', draft: 'Rp 1.500.000', sourceTopic: 'price' } })

    expect(id).toBe('run_1')
    expect(createdData()).toMatchObject({
      conversationId: 'conv_1',
      mode: 'faq',
      status: 'REPLIED',
      replyText: 'Rp 1.500.000',
      inboundText: 'berapa harga ijen?',
      latencyMs: 2500,
      knowledgeRefs: { sourceTopic: 'price' },
    })
  })

  it('pins the run to the flow registry so Decision Logs and Flow Map cannot disagree', async () => {
    await recordBotDecisionRun({ ...base, decision: { mode: 'faq', draft: 'x' } })
    expect(createdData()).toMatchObject({ flowKey: 'whatsapp-existing-bot-v1', flowVersion: 1 })
  })

  it('records a failed run with status FAILED and the error message', async () => {
    await recordBotDecisionRun({ ...base, decision: null, error: 'Ollama timeout' })
    expect(createdData()).toMatchObject({ status: 'FAILED', error: 'Ollama timeout' })
  })

  it('gives a decision-less run a mode derived from its status, keeping the column non-null', async () => {
    await recordBotDecisionRun({ ...base, decision: null, error: 'boom' })
    expect(createdData().mode).toBe('failed')
  })

  it('never clamps latency below zero even if the clocks disagree', async () => {
    await recordBotDecisionRun({ ...base, decision: { mode: 'faq' }, startedAt: finishedAt, finishedAt: startedAt })
    expect(createdData().latencyMs).toBe(0)
  })

  it('sanitises the trace BEFORE writing, so a secret never lands in the database', async () => {
    await recordBotDecisionRun({
      ...base,
      decision: { mode: 'faq', draft: 'x', debug: { accessToken: 'EAAG-secret' } },
    })

    const trace = createdData().trace as { debug: { accessToken: string } }
    expect(trace.debug.accessToken).toBe('[REDACTED]')
    expect(JSON.stringify(createdData())).not.toContain('EAAG-secret')
  })

  // Task 17 (Ruling R54): knowledgeRefs now carries decision.knowledge too, and it goes
  // through sanitizeTrace the same as `trace`/`steps` -- a secret hiding inside a managed
  // knowledge line (an operator-written FAQ answer) must not reach the database intact either.
  it('sertakan knowledge di knowledgeRefs, tersaniter sebelum ditulis', async () => {
    await recordBotDecisionRun({
      ...base,
      decision: {
        mode: 'faq',
        draft: 'x',
        sourceTopic: 'payment',
        knowledge: {
          catalogLines: [],
          managedLines: [{ line: 'Hubungi kami di Bearer abcdefgh12345678', source: 'FAQ (v1)' }],
          rejected: [],
          gateBypassed: false,
        },
      },
    })

    const knowledgeRefs = createdData().knowledgeRefs as {
      sourceTopic: string
      knowledge: { managedLines: Array<{ line: string }> }
    }
    expect(knowledgeRefs.sourceTopic).toBe('payment')
    expect(knowledgeRefs.knowledge.managedLines[0].line).not.toContain('abcdefgh12345678')
    expect(knowledgeRefs.knowledge.managedLines[0].line).toContain('[REDACTED]')
  })

  it('returns null instead of throwing when the write fails', async () => {
    // Recording sits inside the bot's own path. A throw here would abort a turn that had
    // already produced a perfectly good answer.
    mockPrisma.botDecisionRun.create.mockRejectedValue(new Error('db down'))
    await expect(recordBotDecisionRun({ ...base, decision: { mode: 'faq' } })).resolves.toBeNull()
  })
})

/**
 * Task 15: two axes computed every turn (`classifySalesNeed`'s job, the topic classifier's
 * topic) were previously buried in `trace` Json, unqueryable without parsing it. `topic`/`job`
 * are now real columns, derived straight from the `decision` object the same way every other
 * `*ForDecision` helper in this file already works.
 */
describe('topicForDecision / jobForDecision (Task 15)', () => {
  it('reads topic and job straight off the decision when present', () => {
    expect(topicForDecision({ mode: 'clarify', topic: 'payment', job: 'J2' })).toBe('payment')
    expect(jobForDecision({ mode: 'clarify', topic: 'payment', job: 'J2' })).toBe('J2')
  })

  it('falls back to sourceTopic (faq) when topic is absent', () => {
    expect(topicForDecision({ mode: 'faq', sourceTopic: 'inclusions' })).toBe('inclusions')
  })

  it('returns undefined for neither, rather than inventing a value', () => {
    expect(topicForDecision({ mode: 'handoff' })).toBeUndefined()
    expect(jobForDecision({ mode: 'handoff' })).toBeUndefined()
  })
})

describe('recordBotDecisionRun — topic/job columns (Task 15)', () => {
  const base = { conversationId: 'conv_1', inboundText: 'berapa harga ijen?', startedAt, finishedAt }

  it('menulis topic dan job sebagai kolom saat keputusan membawa keduanya', async () => {
    await recordBotDecisionRun({ ...base, decision: { mode: 'clarify', reply: 'Mau ke mana?', topic: 'payment', job: 'J2' } })
    expect(createdData()).toMatchObject({ topic: 'payment', job: 'J2' })
  })

  it('menulis topic dari sourceTopic untuk keputusan faq yang hanya membawa itu', async () => {
    await recordBotDecisionRun({ ...base, decision: { mode: 'faq', draft: 'Rp 1.500.000', sourceTopic: 'price' } })
    expect(createdData()).toMatchObject({ topic: 'price' })
    expect(createdData().job).toBeUndefined()
  })

  it('menerima keputusan tanpa keduanya tanpa melempar, dan tidak menulis kolomnya', async () => {
    await expect(recordBotDecisionRun({ ...base, decision: { mode: 'handoff', reason: 'x' } })).resolves.not.toThrow()
    expect(createdData().topic).toBeUndefined()
    expect(createdData().job).toBeUndefined()
  })
})

describe('attachMessageToDecisionRun', () => {
  it('links the run to the message that carried its reply', async () => {
    mockPrisma.botDecisionRun.update.mockResolvedValue({ id: 'run_1' } as never)
    await attachMessageToDecisionRun('run_1', 'msg_1')
    expect(mockPrisma.botDecisionRun.update).toHaveBeenCalledWith({
      where: { id: 'run_1' },
      data: { messageId: 'msg_1' },
    })
  })

  it('does nothing when the run was never recorded', async () => {
    await attachMessageToDecisionRun(null, 'msg_1')
    expect(mockPrisma.botDecisionRun.update).not.toHaveBeenCalled()
  })

  it('does nothing when no message id could be produced', async () => {
    // sendMessage's return value must never be a hard dependency of the bot's send path.
    await attachMessageToDecisionRun('run_1', undefined)
    expect(mockPrisma.botDecisionRun.update).not.toHaveBeenCalled()
  })

  it('swallows a failed update rather than throwing into the send path', async () => {
    mockPrisma.botDecisionRun.update.mockRejectedValue(new Error('db down'))
    await expect(attachMessageToDecisionRun('run_1', 'msg_1')).resolves.toBeUndefined()
  })
})

/**
 * Regression cover for the audit finding "BotDecisionRun.verification tidak pernah ditulis
 * meski 3 tempat membacanya".
 *
 * The column shipped with three readers — `hasVerification` on the Decision Logs list, the
 * trace panel's verification block, and the Test Lab's result panel — and no writer at all, so
 * all three were permanently empty and nobody could tell that from "this bot never fabricates
 * a price".
 */
describe('verification (regresi Temuan 5b)', () => {
  const verification = {
    status: 'PASSED_AFTER_RETRY',
    attempts: 2,
    fabricatedPrices: [1_500_000],
    unverifiedPrices: [],
    unknownUrls: [],
  }

  it('menulis verdict verifikasi ke kolom yang selama ini kosong', async () => {
    await recordBotDecisionRun({
      conversationId: 'conv_1',
      messageId: 'msg_1',
      inboundText: 'berapa harga paket Bromo?',
      decision: { mode: 'faq', draft: 'Rp1.000.000', sourceTopic: 'pricing', verification },
      startedAt,
      finishedAt,
    })

    expect(createdData().verification).toEqual(verification)
  })

  it('membiarkan kolom kosong untuk cabang yang memang tidak memverifikasi apa pun', async () => {
    // A static destination question never calls the LLM, so there is nothing to verify.
    // Claiming a verification it never ran would be worse than an empty column.
    await recordBotDecisionRun({
      conversationId: 'conv_1',
      messageId: 'msg_1',
      inboundText: 'halo',
      decision: { mode: 'clarify', reply: 'Mau ke mana?' },
      startedAt,
      finishedAt,
    })

    expect(createdData().verification).toBeUndefined()
  })

  it('mengabaikan bentuk yang tidak bisa dibaca, bukan menuliskannya mentah-mentah', () => {
    expect(verificationForDecision({ verification: 'lulus' })).toBeUndefined()
    expect(verificationForDecision({ verification: null })).toBeUndefined()
    expect(verificationForDecision(null)).toBeUndefined()
    expect(verificationForDecision({ verification })).toEqual(verification)
  })
})
