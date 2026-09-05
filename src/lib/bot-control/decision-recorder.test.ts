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

  it('returns null instead of throwing when the write fails', async () => {
    // Recording sits inside the bot's own path. A throw here would abort a turn that had
    // already produced a perfectly good answer.
    mockPrisma.botDecisionRun.create.mockRejectedValue(new Error('db down'))
    await expect(recordBotDecisionRun({ ...base, decision: { mode: 'faq' } })).resolves.toBeNull()
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
