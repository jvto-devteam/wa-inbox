/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import { Prisma, type PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { decideAndRespond } from '@/lib/bot/orchestrator'
import { resolveChannel } from '@/lib/channel-router'
import { ensureTestConversation } from '@/lib/test-conversation'
import { recordBotDecisionRun } from '@/lib/bot-control/decision-recorder'
import { sendMessage } from '@/lib/send'
import { runSimulation, statusForSimulation, replyFromDecision, resolveContextMode } from './simulator'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/bot/orchestrator', () => ({ decideAndRespond: vi.fn() }))
vi.mock('@/lib/channel-router', () => ({ resolveChannel: vi.fn() }))
vi.mock('@/lib/test-conversation', () => ({
  ensureTestConversation: vi.fn(),
  TEST_CONTACT_PHONE: '__bot_test__',
}))
vi.mock('@/lib/bot-control/decision-recorder', () => ({ recordBotDecisionRun: vi.fn() }))
vi.mock('@/lib/send', () => ({ sendMessage: vi.fn() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

beforeEach(() => {
  mockReset(mockPrisma)
  vi.clearAllMocks()
  vi.mocked(ensureTestConversation).mockResolvedValue()
  vi.mocked(resolveChannel).mockResolvedValue('UNOFFICIAL')
  vi.mocked(recordBotDecisionRun).mockResolvedValue('run_sim_1')
  vi.mocked(decideAndRespond).mockResolvedValue({ mode: 'faq', draft: 'Rp 1.500.000', sourceTopic: 'price' })
  mockPrisma.conversation.findFirstOrThrow.mockResolvedValue({ id: 'conv_sandbox', tripBrief: null } as never)
  mockPrisma.conversation.update.mockResolvedValue({ id: 'conv_sandbox' } as never)
  mockPrisma.knowledgeGapLog.deleteMany.mockResolvedValue({ count: 0 } as never)
})

describe('statusForSimulation', () => {
  it('maps each decision mode to a WOULD_* status', () => {
    expect(statusForSimulation({ mode: 'faq', draft: 'x', sourceTopic: 't' })).toBe('WOULD_REPLY')
    expect(statusForSimulation({ mode: 'booking_context', reply: 'x' })).toBe('WOULD_REPLY')
    expect(statusForSimulation({ mode: 'clarify', reply: 'x' })).toBe('WOULD_CLARIFY')
    expect(statusForSimulation({ mode: 'handoff', reason: 'x' })).toBe('WOULD_HANDOFF')
    expect(statusForSimulation(null)).toBe('FAILED')
  })
})

describe('replyFromDecision', () => {
  it('reads the draft or reply, whichever the mode carries', () => {
    expect(replyFromDecision({ mode: 'faq', draft: 'draf', sourceTopic: 't' })).toBe('draf')
    expect(replyFromDecision({ mode: 'clarify', reply: 'tanya' })).toBe('tanya')
  })

  it('returns null for a handoff — its reason is not the customer-facing text', () => {
    expect(replyFromDecision({ mode: 'handoff', reason: 'Minta manusia' })).toBeNull()
  })
})

describe('resolveContextMode', () => {
  it('uses the existing conversation when one is given', () => {
    expect(resolveContextMode({ message: 'x', conversationId: 'c1', useExistingHistory: true })).toBe('conversation')
  })

  it('falls back to the test room when history is explicitly declined', () => {
    expect(resolveContextMode({ message: 'x', conversationId: 'c1', useExistingHistory: false })).toBe('test-room')
  })

  it('runs with no context when no conversation is chosen', () => {
    expect(resolveContextMode({ message: 'x' })).toBe('none')
  })
})

describe('runSimulation', () => {
  it('never sends a WhatsApp message', async () => {
    await runSimulation({ message: 'berapa harga ijen?' })
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('does not import the send path at all — a structural guarantee, not a promise', () => {
    // The strongest form of "simulator tidak memanggil sendMessage" (guidebook §21.1): a
    // future edit that adds the import fails here, before anyone has to notice it at runtime.
    // Comments are stripped first: the file's own header explains at length that it never
    // calls sendMessage, and matching that prose would make this assert nothing about the code.
    const source = readFileSync(path.join(__dirname, 'simulator.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')

    expect(source).not.toMatch(/from '@\/lib\/send'/)
    expect(source).not.toMatch(/\bsendMessage\s*\(/)
    expect(source).not.toMatch(/\benqueueOutboundJob\s*\(/)
  })

  it('runs the real decision engine and returns its verdict', async () => {
    const result = await runSimulation({ message: 'berapa harga ijen?' })

    expect(decideAndRespond).toHaveBeenCalledWith('conv_sandbox', 'berapa harga ijen?')
    expect(result).toMatchObject({
      mode: 'faq',
      status: 'WOULD_REPLY',
      reply: 'Rp 1.500.000',
      knowledgeRefs: { sourceTopic: 'price' },
      wouldSendViaChannel: 'UNOFFICIAL',
      decisionRunId: 'run_sim_1',
    })
  })

  it('always runs against the sandbox conversation, never the chosen one', async () => {
    // decideAndRespond writes tripBrief, booking columns and knowledge-gap rows. Pointing it at
    // a real conversation would let a dry run rewrite a customer's state.
    await runSimulation({ message: 'halo', conversationId: 'conv_real', useExistingHistory: true })
    expect(decideAndRespond).toHaveBeenCalledWith('conv_sandbox', 'halo')
  })

  it('copies the chosen conversation trip brief into the sandbox', async () => {
    mockPrisma.conversation.findUnique.mockResolvedValue({
      tripBrief: { destination: 'ijen', origin: 'Bali' },
      bookingData: null,
    } as never)

    await runSimulation({ message: 'halo', conversationId: 'conv_real', useExistingHistory: true })

    expect(mockPrisma.conversation.update).toHaveBeenCalledWith({
      where: { id: 'conv_sandbox' },
      data: { tripBrief: { destination: 'ijen', origin: 'Bali' } },
    })
  })

  it('restores the sandbox trip brief afterwards so runs do not accumulate state', async () => {
    mockPrisma.conversation.findFirstOrThrow.mockResolvedValue({
      id: 'conv_sandbox',
      tripBrief: { destination: 'bromo' },
    } as never)
    mockPrisma.conversation.findUnique.mockResolvedValue({ tripBrief: { destination: 'ijen' }, bookingData: null } as never)

    await runSimulation({ message: 'halo', conversationId: 'conv_real', useExistingHistory: true })

    const updates = mockPrisma.conversation.update.mock.calls.map((call) => call[0].data)
    expect(updates[updates.length - 1]).toEqual({ tripBrief: { destination: 'bromo' } })
  })

  it('restores a sandbox that had no trip brief using the DbNull sentinel', async () => {
    // Prisma rejects a plain JS null on a nullable Json column at runtime.
    await runSimulation({ message: 'halo' })
    const updates = mockPrisma.conversation.update.mock.calls.map((call) => call[0].data)
    expect(updates[updates.length - 1]).toEqual({ tripBrief: Prisma.DbNull })
  })

  it('deletes knowledge-gap rows the simulation filed against the sandbox', async () => {
    // A simulated question must not appear in the operator's real gap-to-task list.
    await runSimulation({ message: 'pertanyaan aneh' })

    const call = mockPrisma.knowledgeGapLog.deleteMany.mock.calls[0][0]
    expect(call?.where).toMatchObject({ conversationId: 'conv_sandbox' })
    expect(call?.where?.createdAt).toHaveProperty('gte')
  })

  it('warns that the run happened in the sandbox', async () => {
    const result = await runSimulation({ message: 'halo' })
    expect(result.warnings[0]).toContain('sandbox')
  })

  it('warns that booking context cannot be reproduced when the conversation has a booking', async () => {
    // ensureFreshBookingData returns null for any isTest conversation by design, so
    // booking_context mode is genuinely unreachable here. Reported, not hidden.
    mockPrisma.conversation.findUnique.mockResolvedValue({
      tripBrief: null,
      bookingData: { bookingCode: 'JV-1' },
    } as never)

    const result = await runSimulation({ message: 'halo', conversationId: 'conv_real', useExistingHistory: true })
    expect(result.warnings.some((w) => w.includes('booking_context'))).toBe(true)
  })

  it('warns when the chosen conversation does not exist instead of failing the run', async () => {
    mockPrisma.conversation.findUnique.mockResolvedValue(null as never)

    const result = await runSimulation({ message: 'halo', conversationId: 'gone', useExistingHistory: true })
    expect(result.warnings.some((w) => w.includes('tidak ditemukan'))).toBe(true)
    expect(result.status).toBe('WOULD_REPLY')
  })

  it('says so when contactPhone was supplied but could not steer the run', async () => {
    const result = await runSimulation({ message: 'halo', contactPhone: '628123' })
    expect(result.warnings.some((w) => w.includes('contactPhone'))).toBe(true)
  })

  it('returns FAILED with the error in warnings when the engine throws', async () => {
    vi.mocked(decideAndRespond).mockRejectedValue(new Error('Ollama timeout'))

    const result = await runSimulation({ message: 'halo' })

    expect(result.status).toBe('FAILED')
    expect(result.reply).toBeNull()
    expect(result.warnings.some((w) => w.includes('Ollama timeout'))).toBe(true)
  })

  it('still restores the sandbox when the engine throws', async () => {
    vi.mocked(decideAndRespond).mockRejectedValue(new Error('boom'))
    await runSimulation({ message: 'halo' })
    expect(mockPrisma.knowledgeGapLog.deleteMany).toHaveBeenCalled()
  })

  it('records the run as SIMULATED so it can never be read as production traffic', async () => {
    await runSimulation({ message: 'halo' })
    expect(recordBotDecisionRun).toHaveBeenCalledWith(expect.objectContaining({ simulated: true }))
  })

  it('records against the sandbox conversation, not the chosen one', async () => {
    mockPrisma.conversation.findUnique.mockResolvedValue({ tripBrief: null, bookingData: null } as never)
    await runSimulation({ message: 'halo', conversationId: 'conv_real', useExistingHistory: true })
    expect(recordBotDecisionRun).toHaveBeenCalledWith(expect.objectContaining({ conversationId: 'conv_sandbox' }))
  })
})
