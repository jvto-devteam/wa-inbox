import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/require-admin'
import { writeBotAuditLog } from '@/lib/bot-control/audit'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: vi.fn() }))
vi.mock('@/lib/bot-control/audit', () => ({ writeBotAuditLog: vi.fn() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>
import { POST } from './route'

function req(body: unknown) {
  return new Request('http://t/api/bot/channel-toggle', { method: 'POST', body: JSON.stringify(body) })
}

beforeEach(() => {
  mockReset(mockPrisma)
  vi.mocked(requireAdmin).mockResolvedValue({ accountId: 'a1', role: 'ADMIN' } as never)
  vi.mocked(writeBotAuditLog).mockReset()
  mockPrisma.account.findUnique.mockResolvedValue({ name: 'Dave' } as never)
})

describe('POST /api/bot/channel-toggle', () => {
  it('menolak yang bukan admin dengan 403', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(null)
    const res = await POST(req({ platform: 'FACEBOOK' }))
    expect(res.status).toBe(403)
    expect(mockPrisma.settings.update).not.toHaveBeenCalled()
  })

  it('menolak platform yang tidak dikenal dengan 400', async () => {
    const res = await POST(req({ platform: 'TIKTOK' }))
    expect(res.status).toBe(400)
    expect(mockPrisma.settings.update).not.toHaveBeenCalled()
  })

  // Inti desainnya: sakelar adalah PENULIS MASSAL, bukan gerbang kedua. Kalau updateMany
  // ini hilang, sakelar hanya berlaku untuk percakapan baru dan operator akan melihat
  // toggle menyala sementara chat-chat lama tetap diam.
  it('menulis massal botEnabled ke percakapan platform itu saja', async () => {
    mockPrisma.settings.findUniqueOrThrow.mockResolvedValue({ botEnabledFacebook: false } as never)
    mockPrisma.settings.update.mockResolvedValue({ botEnabledFacebook: true } as never)

    await POST(req({ platform: 'FACEBOOK' }))

    expect(mockPrisma.conversation.updateMany).toHaveBeenCalledWith({
      where: { channelIdentity: { platform: 'FACEBOOK' } },
      data: { botEnabled: true },
    })
  })

  // --- Temuan I-2: sakelar channel membatalkan filter nomor Indonesia ---
  //
  // Sebelumnya route ini menulis massal tanpa pernah membaca skipBotForIndonesianNumbers.
  // Operator menyalakan filter (semua percakapan +62 -> false), lalu mematikan dan menyalakan
  // lagi sakelar WhatsApp: SELURUH percakapan +62 kembali true sementara /chatbot masih
  // menampilkan filter itu menyala, dan bot membalas otomatis pelanggan Indonesia yang secara
  // eksplisit diminta ditangani manusia. Dua tulisan terpisah, meniru bot/mode.
  it('filter +62 aktif: menyalakan WhatsApp tidak menghidupkan percakapan Indonesia', async () => {
    mockPrisma.settings.findUniqueOrThrow.mockResolvedValue({ botEnabledWhatsapp: false, skipBotForIndonesianNumbers: true } as never)
    mockPrisma.settings.update.mockResolvedValue({ botEnabledWhatsapp: true } as never)

    await POST(req({ platform: 'WHATSAPP' }))

    expect(mockPrisma.conversation.updateMany).toHaveBeenCalledWith({
      where: { channelIdentity: { platform: 'WHATSAPP' }, contact: { phone: { not: { startsWith: '62' } } } },
      data: { botEnabled: true },
    })
    expect(mockPrisma.conversation.updateMany).toHaveBeenCalledWith({
      where: { channelIdentity: { platform: 'WHATSAPP' }, contact: { phone: { startsWith: '62' } } },
      data: { botEnabled: false },
    })
    // Tidak pernah lagi satu tulisan massal yang menyapu +62 ikut menyala.
    expect(mockPrisma.conversation.updateMany).not.toHaveBeenCalledWith({
      where: { channelIdentity: { platform: 'WHATSAPP' } },
      data: { botEnabled: true },
    })
  })

  it('filter +62 mati: menyalakan WhatsApp menghidupkan semua percakapan WhatsApp dalam satu tulisan', async () => {
    mockPrisma.settings.findUniqueOrThrow.mockResolvedValue({ botEnabledWhatsapp: false, skipBotForIndonesianNumbers: false } as never)
    mockPrisma.settings.update.mockResolvedValue({ botEnabledWhatsapp: true } as never)

    await POST(req({ platform: 'WHATSAPP' }))

    expect(mockPrisma.conversation.updateMany).toHaveBeenCalledTimes(1)
    expect(mockPrisma.conversation.updateMany).toHaveBeenCalledWith({
      where: { channelIdentity: { platform: 'WHATSAPP' } },
      data: { botEnabled: true },
    })
  })

  // Filter nomor Indonesia tidak punya arti di platform yang identitasnya bukan nomor telepon
  // (hasPhoneNumber, src/lib/channel/platform.ts): IGSID/PSID adalah angka panjang, jadi
  // menerapkan `phone startsWith '62'` di sana hanya menghasilkan penyaringan yang tampak
  // berlaku padahal tidak pernah mengenai apa pun.
  it('menyalakan platform tanpa nomor telepon tidak terpengaruh filter +62', async () => {
    mockPrisma.settings.findUniqueOrThrow.mockResolvedValue({ botEnabledInstagram: false, skipBotForIndonesianNumbers: true } as never)
    mockPrisma.settings.update.mockResolvedValue({ botEnabledInstagram: true } as never)

    await POST(req({ platform: 'INSTAGRAM' }))

    expect(mockPrisma.conversation.updateMany).toHaveBeenCalledTimes(1)
    expect(mockPrisma.conversation.updateMany).toHaveBeenCalledWith({
      where: { channelIdentity: { platform: 'INSTAGRAM' } },
      data: { botEnabled: true },
    })
  })

  it('mematikan WhatsApp tetap satu tulisan tanpa syarat walau filter +62 aktif', async () => {
    mockPrisma.settings.findUniqueOrThrow.mockResolvedValue({ botEnabledWhatsapp: true, skipBotForIndonesianNumbers: true } as never)
    mockPrisma.settings.update.mockResolvedValue({ botEnabledWhatsapp: false } as never)

    await POST(req({ platform: 'WHATSAPP' }))

    expect(mockPrisma.conversation.updateMany).toHaveBeenCalledTimes(1)
    expect(mockPrisma.conversation.updateMany).toHaveBeenCalledWith({
      where: { channelIdentity: { platform: 'WHATSAPP' } },
      data: { botEnabled: false },
    })
  })

  it('mencatat audit log dengan aksi ENABLE saat dinyalakan', async () => {
    mockPrisma.settings.findUniqueOrThrow.mockResolvedValue({ botEnabledInstagram: false } as never)
    mockPrisma.settings.update.mockResolvedValue({ botEnabledInstagram: true } as never)

    await POST(req({ platform: 'INSTAGRAM' }))

    expect(writeBotAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'ENABLE', entityType: 'BOT_SETTING', entityKey: 'botEnabledInstagram',
    }))
  })
})
