import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { resolveChannelContact } from '@/lib/channel/contact-channel'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/channel/contact-channel', () => ({ resolveChannelContact: vi.fn() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>
import { GET } from './route'

const call = () => GET(new Request('http://localhost/api/conversations/conv_1/channel'), { params: Promise.resolve({ id: 'conv_1' }) })

beforeEach(() => {
  mockReset(mockPrisma)
  vi.mocked(resolveChannelContact).mockReset().mockResolvedValue({
    platform: 'INSTAGRAM', platformLabel: 'Instagram', value: '@sinta.jvto', href: 'https://www.instagram.com/sinta.jvto/', linkLabel: 'Buka profil Instagram',
  })
})

describe('GET /api/conversations/[id]/channel', () => {
  it('meneruskan identitas percakapan ke resolveChannelContact', async () => {
    mockPrisma.conversation.findUnique.mockResolvedValue({
      channelIdentity: { platform: 'INSTAGRAM', externalId: 'igsid_1', displayName: 'Sinta' }, contact: { phone: null },
    } as never)

    const res = await call()
    expect(res.status).toBe(200)
    expect(resolveChannelContact).toHaveBeenCalledWith({ platform: 'INSTAGRAM', externalId: 'igsid_1', displayName: 'Sinta' })
    expect(await res.json()).toEqual({ contact: expect.objectContaining({ value: '@sinta.jvto' }) })
  })

  it('percakapan lama tanpa ChannelIdentity jatuh ke nomor WhatsApp kontaknya', async () => {
    mockPrisma.conversation.findUnique.mockResolvedValue({ channelIdentity: null, contact: { phone: '6281234' } } as never)
    await call()
    expect(resolveChannelContact).toHaveBeenCalledWith({ platform: 'WHATSAPP', externalId: '6281234', displayName: null })
  })

  it('tanpa identitas dan tanpa nomor: contact null', async () => {
    mockPrisma.conversation.findUnique.mockResolvedValue({ channelIdentity: null, contact: { phone: null } } as never)
    expect(await (await call()).json()).toEqual({ contact: null })
    expect(resolveChannelContact).not.toHaveBeenCalled()
  })

  it('percakapan tidak ada: 404 dengan { error }', async () => {
    mockPrisma.conversation.findUnique.mockResolvedValue(null as never)
    const res = await call()
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: expect.any(String) })
  })

  it('error tak terduga: 500 tanpa membocorkan pesan mentah', async () => {
    mockPrisma.conversation.findUnique.mockRejectedValue(new Error('rahasia koneksi db'))
    const res = await call()
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('rahasia')
  })
})
