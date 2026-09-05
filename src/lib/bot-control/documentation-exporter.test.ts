/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { checkDeploymentGate } from '@/lib/bot/deployment-gate'
import { generateBotDocumentation, DOCUMENTATION_SECTIONS } from './documentation-exporter'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/bot/deployment-gate', () => ({ checkDeploymentGate: vi.fn() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>
const generatedAt = new Date('2026-09-05T04:00:00.000Z')

// Prisma's `groupBy` is a heavily overloaded generic, so vitest-mock-extended cannot surface a
// plain mock signature for it and `.mockResolvedValue` does not typecheck. Narrowed once here
// rather than casting at each call site.
const groupByMock = mockPrisma.knowledgeGapLog.groupBy as unknown as ReturnType<typeof vi.fn>

function settingsRow(overrides: Record<string, unknown> = {}) {
  return {
    defaultChannel: 'UNOFFICIAL',
    botAutoReplyAll: true,
    skipBotForIndonesianNumbers: false,
    ollamaModel: 'gemma4:31b-cloud',
    workingHoursStart: '08:00',
    workingHoursEnd: '17:00',
    offHoursAutoReply: 'Kami balas besok pagi.',
    catalogSyncedAt: new Date('2026-09-01T00:00:00.000Z'),
    ...overrides,
  } as never
}

beforeEach(() => {
  mockReset(mockPrisma)
  vi.clearAllMocks()
  vi.mocked(checkDeploymentGate).mockReturnValue({ readyForApproval: true, blocking: [] })
  mockPrisma.settings.findUnique.mockResolvedValue(settingsRow())
  mockPrisma.knowledgeSource.findMany.mockResolvedValue([
    {
      title: 'Policy Cards',
      type: 'CATALOG_JSON',
      sourcePath: 'catalog/policy-cards.json',
      status: 'PUBLISHED',
      lastSyncedAt: new Date('2026-09-05T03:00:00.000Z'),
      _count: { chunks: 10 },
    },
  ] as never)
  mockPrisma.template.findMany.mockResolvedValue([
    { name: 'Konfirmasi Booking', type: 'OFFICIAL', format: 'TEXT', category: 'UTILITY', metaStatus: 'APPROVED' },
  ] as never)
  groupByMock.mockResolvedValue([{ topic: 'rooming', reason: 'no_facts_resolved', _count: { _all: 4 } }])
})

describe('generateBotDocumentation', () => {
  it('includes every mandated section, in order', async () => {
    const doc = await generateBotDocumentation({ generatedAt })

    let cursor = -1
    for (const section of DOCUMENTATION_SECTIONS) {
      const index = doc.indexOf(`## ${section}`)
      expect(index, section).toBeGreaterThan(-1)
      expect(index, `${section} out of order`).toBeGreaterThan(cursor)
      cursor = index
    }
  })

  it('stamps when it was generated', async () => {
    const doc = await generateBotDocumentation({ generatedAt })
    expect(doc).toContain('2026-09-05T04:00:00.000Z')
  })

  it('reports the live bot mode, model and catalog sync', async () => {
    const doc = await generateBotDocumentation({ generatedAt })
    expect(doc).toContain('Aktif untuk semua chat')
    expect(doc).toContain('gemma4:31b-cloud')
  })

  it('lists all 28 flow steps with their source files', async () => {
    const doc = await generateBotDocumentation({ generatedAt })
    expect(doc).toContain('WhatsApp Existing Bot (v1, 28 langkah)')
    expect(doc).toContain('src/lib/bot/orchestrator.ts')
    expect(doc).toContain('Webhook Meta diterima')
  })

  it('lists every registered rule', async () => {
    const doc = await generateBotDocumentation({ generatedAt })
    expect(doc).toContain('Tidak boleh mengarang harga')
    expect(doc).toContain('Tidak boleh mengarang URL')
    expect(doc).toContain('Unofficial sebagai outbound default')
  })

  it('includes indexed knowledge sources with their paths and chunk counts', async () => {
    const doc = await generateBotDocumentation({ generatedAt })
    expect(doc).toContain('catalog/policy-cards.json')
    expect(doc).toContain('Policy Cards')
  })

  it('summarises templates and known gaps', async () => {
    const doc = await generateBotDocumentation({ generatedAt })
    expect(doc).toContain('Konfirmasi Booking')
    expect(doc).toContain('rooming')
    expect(doc).toContain('no_facts_resolved')
  })

  it('flags a configured default channel that disagrees with the written policy', async () => {
    // The owner reading this document is exactly who should learn that policy and
    // configuration have drifted apart.
    mockPrisma.settings.findUnique.mockResolvedValue(settingsRow({ defaultChannel: 'OFFICIAL' }))

    const doc = await generateBotDocumentation({ generatedAt })
    expect(doc).toContain('Perlu diperhatikan')
    expect(doc).toContain('konfigurasi saat ini adalah OFFICIAL')
  })

  it('does not flag anything when policy and configuration agree', async () => {
    const doc = await generateBotDocumentation({ generatedAt })
    expect(doc).not.toContain('Perlu diperhatikan')
  })

  it('reports a closed deployment gate with its blocking reasons', async () => {
    vi.mocked(checkDeploymentGate).mockReturnValue({ readyForApproval: false, blocking: ['menunggu persetujuan operator'] })
    const doc = await generateBotDocumentation({ generatedAt })
    expect(doc).toContain('Tertutup: menunggu persetujuan operator')
  })

  it('survives a deployment gate that throws on a fresh checkout', async () => {
    vi.mocked(checkDeploymentGate).mockImplementation(() => {
      throw new Error('no catalog')
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const doc = await generateBotDocumentation({ generatedAt })
    expect(doc).toContain('Tidak bisa dibaca')
  })

  it('marks an unreadable section explicitly instead of leaving an empty heading', async () => {
    // A silently truncated document would have an owner conclude the bot has no knowledge.
    mockPrisma.knowledgeSource.findMany.mockRejectedValue(new Error('db down'))

    const doc = await generateBotDocumentation({ generatedAt })
    expect(doc).toContain('_Bagian ini tidak bisa dibaca saat dokumen dibuat._')
    // Everything else still renders.
    expect(doc).toContain('Konfirmasi Booking')
  })

  it('still produces a document when Settings cannot be read', async () => {
    mockPrisma.settings.findUnique.mockRejectedValue(new Error('db down'))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const doc = await generateBotDocumentation({ generatedAt })
    for (const section of DOCUMENTATION_SECTIONS) expect(doc).toContain(`## ${section}`)
  })

  it('says so when nothing has been indexed yet, rather than showing an empty table', async () => {
    mockPrisma.knowledgeSource.findMany.mockResolvedValue([] as never)
    const doc = await generateBotDocumentation({ generatedAt })
    expect(doc).toContain('Index ulang katalog')
  })

  it('never reads the credentials table', async () => {
    // Structural: the exporter must not be able to put a token in a document that gets emailed.
    await generateBotDocumentation({ generatedAt })
    expect(mockPrisma.waNumber.findMany).not.toHaveBeenCalled()
    expect(mockPrisma.waNumber.findFirst).not.toHaveBeenCalled()
    expect(mockPrisma.waNumber.findFirstOrThrow).not.toHaveBeenCalled()
  })

  it('selects Settings columns explicitly, so a future secret column cannot leak in', async () => {
    await generateBotDocumentation({ generatedAt })
    const select = mockPrisma.settings.findUnique.mock.calls[0][0]?.select
    expect(select).toBeDefined()
    expect(Object.keys(select ?? {})).toEqual([
      'defaultChannel',
      'botAutoReplyAll',
      'skipBotForIndonesianNumbers',
      'ollamaModel',
      'workingHoursStart',
      'workingHoursEnd',
      'offHoursAutoReply',
      'catalogSyncedAt',
    ])
  })

  it('does not select template bodies, which can carry customer-specific text', async () => {
    await generateBotDocumentation({ generatedAt })
    const select = mockPrisma.template.findMany.mock.calls[0][0]?.select
    expect(select).not.toHaveProperty('body')
  })

  it('contains no secret-looking content', async () => {
    const doc = await generateBotDocumentation({ generatedAt })
    for (const needle of ['accessToken', 'coexistApiKey', 'passwordHash', 'META_APP_SECRET', 'Bearer ']) {
      expect(doc, needle).not.toContain(needle)
    }
  })

  it('escapes pipes so one stray character cannot break every table below it', async () => {
    mockPrisma.template.findMany.mockResolvedValue([
      { name: 'Promo | Diskon', type: 'QUICK_REPLY', format: 'TEXT', category: null, metaStatus: 'NOT_APPLICABLE' },
    ] as never)

    const doc = await generateBotDocumentation({ generatedAt })
    expect(doc).toContain('Promo \\| Diskon')
  })
})
