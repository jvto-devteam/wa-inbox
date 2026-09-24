import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { verifySessionToken } from '@/lib/auth/session'
import { writeBotAuditLog } from '@/lib/bot-control/audit'
import { POST } from './route'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/auth/session', () => ({ verifySessionToken: vi.fn() }))
vi.mock('@/lib/bot-control/audit', () => ({ writeBotAuditLog: vi.fn() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>

function request(withCookie = true) {
  return new Request('http://localhost/api/bot/mode', {
    method: 'POST',
    headers: withCookie ? { cookie: 'wa_inbox_session=tok' } : {},
  })
}

beforeEach(() => {
  mockReset(mockPrisma)
  vi.clearAllMocks()
  vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_admin', role: 'ADMIN', tokenVersion: 0 })
  vi.mocked(writeBotAuditLog).mockResolvedValue('audit_1')
  mockPrisma.conversation.updateMany.mockResolvedValue({ count: 0 } as never)
  mockPrisma.account.findUnique.mockResolvedValue({ name: 'Admin Satu' } as never)
})

// Posisi keempat sakelar channel ikut menentukan apa yang ditulis sakelar global saat
// dinyalakan (Temuan I-3), jadi setiap test menyebutkannya eksplisit. Default di sini sama
// dengan default schema: hanya WhatsApp menyala.
function settings(overrides: Record<string, unknown> = {}) {
  return {
    botAutoReplyAll: false,
    skipBotForIndonesianNumbers: false,
    botEnabledWhatsapp: true,
    botEnabledInstagram: false,
    botEnabledFacebook: false,
    botEnabledEmail: false,
    ...overrides,
  } as never
}

describe('POST /api/bot/mode', () => {
  it('flips botAutoReplyAll when called by an admin', async () => {
    mockPrisma.settings.findUniqueOrThrow.mockResolvedValue(settings({ botAutoReplyAll: false }))
    mockPrisma.settings.update.mockResolvedValue({ botAutoReplyAll: true } as never)
    const res = await POST(request())
    expect((await res.json()).botAutoReplyAll).toBe(true)
  })

  it('bulk-activates every conversation on a switched-on platform when flipping Off -> On', async () => {
    mockPrisma.settings.findUniqueOrThrow.mockResolvedValue(
      settings({ botAutoReplyAll: false, botEnabledWhatsapp: true, botEnabledFacebook: true })
    )
    mockPrisma.settings.update.mockResolvedValue({ botAutoReplyAll: true } as never)

    await POST(request())

    expect(mockPrisma.settings.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { botAutoReplyAll: true } })
    expect(mockPrisma.conversation.updateMany).toHaveBeenCalledWith({
      where: { channelIdentity: { platform: { in: ['WHATSAPP', 'FACEBOOK'] } } },
      data: { botEnabled: true },
    })
  })

  it('bulk-deactivates every conversation when flipping On -> Off, leaving per-chat re-activation to agents', async () => {
    mockPrisma.settings.findUniqueOrThrow.mockResolvedValue(settings({ botAutoReplyAll: true }))
    mockPrisma.settings.update.mockResolvedValue({ botAutoReplyAll: false } as never)

    await POST(request())

    expect(mockPrisma.settings.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { botAutoReplyAll: false } })
    expect(mockPrisma.conversation.updateMany).toHaveBeenCalledWith({ data: { botEnabled: false } })
  })

  // --- Temuan I-3: sakelar global menimpa keempat sakelar channel ---
  //
  // `updateMany({ data: { botEnabled: next } })` TANPA `where` menyentuh setiap percakapan di
  // setiap platform. Begitu Instagram/Facebook/Email ada isinya, menekan "On" global saat
  // botEnabledInstagram=false menyalakan bot di setiap percakapan Instagram, dan /chatbot lalu
  // menampilkan "Instagram — Bot: Off" di sebelah chat Instagram yang sedang dijawab bot.
  it('tidak menyalakan percakapan di platform yang sakelar channel-nya mati', async () => {
    mockPrisma.settings.findUniqueOrThrow.mockResolvedValue(
      settings({ botAutoReplyAll: false, botEnabledWhatsapp: true, botEnabledInstagram: false })
    )
    mockPrisma.settings.update.mockResolvedValue({ botAutoReplyAll: true } as never)

    await POST(request())

    // Yang dinyalakan hanya WhatsApp.
    expect(mockPrisma.conversation.updateMany).toHaveBeenCalledWith({
      where: { channelIdentity: { platform: { in: ['WHATSAPP'] } } },
      data: { botEnabled: true },
    })
    // Dan komplemennya ditulis false, bukan dibiarkan memegang `true` yang basi.
    expect(mockPrisma.conversation.updateMany).toHaveBeenCalledWith({
      where: { OR: [{ channelIdentity: { platform: { notIn: ['WHATSAPP'] } } }] },
      data: { botEnabled: false },
    })
    // Tidak pernah lagi tulisan massal tanpa `where` saat menyalakan.
    expect(mockPrisma.conversation.updateMany).not.toHaveBeenCalledWith({ data: { botEnabled: true } })
  })

  it('tidak menyalakan apa pun kalau keempat sakelar channel mati', async () => {
    mockPrisma.settings.findUniqueOrThrow.mockResolvedValue(
      settings({ botAutoReplyAll: false, botEnabledWhatsapp: false })
    )
    mockPrisma.settings.update.mockResolvedValue({ botAutoReplyAll: true } as never)

    await POST(request())

    expect(mockPrisma.conversation.updateMany).toHaveBeenCalledWith({
      where: { channelIdentity: { platform: { in: [] } } },
      data: { botEnabled: true },
    })
  })

  // The Indonesia filter (see src/app/api/bot/indonesia-filter/route.ts) must survive an
  // unrelated botAutoReplyAll flip -- turning the overall bot back On must not silently
  // re-activate the numbers the operator specifically asked to keep human-handled.
  it('does NOT re-activate Indonesian-number conversations when flipping Off -> On while the Indonesia filter is active', async () => {
    mockPrisma.settings.findUniqueOrThrow.mockResolvedValue(
      settings({ botAutoReplyAll: false, skipBotForIndonesianNumbers: true, botEnabledWhatsapp: true })
    )
    mockPrisma.settings.update.mockResolvedValue({ botAutoReplyAll: true } as never)

    await POST(request())

    expect(mockPrisma.conversation.updateMany).toHaveBeenCalledWith({
      where: {
        channelIdentity: { platform: { in: ['WHATSAPP'] } },
        contact: { phone: { not: { startsWith: '62' } } },
      },
      data: { botEnabled: true },
    })
    expect(mockPrisma.conversation.updateMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { channelIdentity: { platform: { notIn: ['WHATSAPP'] } } },
          { contact: { phone: { startsWith: '62' } } },
        ],
      },
      data: { botEnabled: false },
    })
    // Never the old single unconditional bulk write when the filter is active.
    expect(mockPrisma.conversation.updateMany).not.toHaveBeenCalledWith({ data: { botEnabled: true } })
  })

  it('still does a single unconditional bulk write when flipping On -> Off, even with the Indonesia filter active (turning the whole bot off makes the filter moot)', async () => {
    mockPrisma.settings.findUniqueOrThrow.mockResolvedValue(
      settings({ botAutoReplyAll: true, skipBotForIndonesianNumbers: true })
    )
    mockPrisma.settings.update.mockResolvedValue({ botAutoReplyAll: false } as never)

    await POST(request())

    expect(mockPrisma.conversation.updateMany).toHaveBeenCalledWith({ data: { botEnabled: false } })
    expect(mockPrisma.conversation.updateMany).toHaveBeenCalledTimes(1)
  })

  // Tombol berhenti darurat harus benar-benar menghentikan semuanya: tanpa `where` sama sekali,
  // termasuk percakapan di platform yang sakelar channel-nya menyala DAN percakapan yang belum
  // punya baris channelIdentity (yang tidak akan terlihat oleh where berbasis platform).
  it('Off tetap satu tulisan tanpa where, apa pun posisi sakelar channel', async () => {
    mockPrisma.settings.findUniqueOrThrow.mockResolvedValue(
      settings({ botAutoReplyAll: true, botEnabledWhatsapp: true, botEnabledInstagram: true, botEnabledFacebook: true, botEnabledEmail: true })
    )
    mockPrisma.settings.update.mockResolvedValue({ botAutoReplyAll: false } as never)

    await POST(request())

    expect(mockPrisma.conversation.updateMany).toHaveBeenCalledTimes(1)
    expect(mockPrisma.conversation.updateMany).toHaveBeenCalledWith({ data: { botEnabled: false } })
  })

  it('records who turned the global bot switch off, and when', async () => {
    // The single biggest lever in the product: Off here stops EVERY customer being answered.
    // Settings shows only the position the switch is in now, so this row is the only thing that
    // answers "who did that, and when" the morning after.
    mockPrisma.settings.findUniqueOrThrow.mockResolvedValue({ botAutoReplyAll: true } as never)
    mockPrisma.settings.update.mockResolvedValue({ botAutoReplyAll: false } as never)

    await POST(request())

    expect(writeBotAuditLog).toHaveBeenCalledTimes(1)
    expect(writeBotAuditLog).toHaveBeenCalledWith({
      action: 'DISABLE',
      entityType: 'BOT_SETTING',
      entityKey: 'botAutoReplyAll',
      actorId: 'acc_admin',
      actorName: 'Admin Satu',
    })
  })

  it('records the switch going back on as ENABLE', async () => {
    mockPrisma.settings.findUniqueOrThrow.mockResolvedValue({ botAutoReplyAll: false } as never)
    mockPrisma.settings.update.mockResolvedValue({ botAutoReplyAll: true } as never)

    await POST(request())

    expect(writeBotAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'ENABLE' }))
  })

  it('rejects when the caller is not an admin — an agent must not be able to halt all bot automation', async () => {
    vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_agent', role: 'AGENT', tokenVersion: 0 })
    const res = await POST(request())
    expect(res.status).toBe(403)
    expect(mockPrisma.settings.update).not.toHaveBeenCalled()
    expect(mockPrisma.conversation.updateMany).not.toHaveBeenCalled()
    // Nothing happened, so nothing is recorded as having happened.
    expect(writeBotAuditLog).not.toHaveBeenCalled()
  })

  it('rejects when there is no session cookie at all', async () => {
    const res = await POST(request(false))
    expect(res.status).toBe(403)
    expect(mockPrisma.settings.update).not.toHaveBeenCalled()
  })
})
