import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { upsertChannelIdentity } from '@/lib/channel/identity'
import type { MessengerWebhookPayload } from '@/lib/meta/messenger-types'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/channel/identity', () => ({ upsertChannelIdentity: vi.fn() }))
vi.mock('@/lib/realtime', () => ({ broadcast: vi.fn() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>
import { ingestMessengerPayload } from './inbound-messenger'

const payload: MessengerWebhookPayload = {
  object: 'page',
  entry: [{
    id: 'page_1',
    time: 1758000000000,
    messaging: [{
      sender: { id: 'psid_abc' },
      recipient: { id: 'page_1' },
      timestamp: 1758000000000,
      message: { mid: 'm_fb_1', text: 'Halo, masih ada slot Bromo?' },
    }],
  }],
}

beforeEach(() => {
  mockReset(mockPrisma)
  vi.mocked(upsertChannelIdentity).mockReset().mockResolvedValue({ id: 'ci_fb_1', contactId: 'contact_fb_1' })
  mockPrisma.message.findUnique.mockResolvedValue(null as never)
  // Default eksplisit: identitas BELUM ada. Tanpa baris ini mock mengembalikan undefined,
  // yang kebetulan berperilaku sama -- dan "kebetulan benar" adalah cara test berbohong.
  mockPrisma.channelIdentity.findUnique.mockResolvedValue(null as never)
  mockPrisma.contact.create.mockResolvedValue({ id: 'contact_fb_1', phone: null } as never)
  mockPrisma.conversation.upsert.mockResolvedValue({ id: 'conv_fb_1', botEnabled: false } as never)
  mockPrisma.message.create.mockResolvedValue({ id: 'msg_fb_1' } as never)
  // `botAutoReplyAll` WAJIB ada: sejak perbaikan regresi C-1, defaultBotEnabled membaca
  // sakelar global DAN sakelar platform. Tanpa kolom ini nilainya undefined, ekspresinya
  // jadi falsy, dan test yang mengharapkan botEnabled=false lulus karena alasan yang salah.
  mockPrisma.settings.findUniqueOrThrow.mockResolvedValue({
    botAutoReplyAll: true, botEnabledFacebook: false, skipBotForIndonesianNumbers: false,
  } as never)
})

describe('ingestMessengerPayload', () => {
  it('menyimpan pesan masuk dan menghitungnya sebagai processed', async () => {
    const result = await ingestMessengerPayload(payload, 'FACEBOOK')
    expect(result).toEqual({ processed: 1, skipped: 0 })
    expect(mockPrisma.message.create).toHaveBeenCalled()
  })

  it('memakai PSID sebagai externalId identitas Facebook', async () => {
    await ingestMessengerPayload(payload, 'FACEBOOK')
    expect(upsertChannelIdentity).toHaveBeenCalledWith(
      expect.objectContaining({ platform: 'FACEBOOK', externalId: 'psid_abc' }),
    )
  })

  // Contact Facebook TIDAK punya nomor telepon. Sebelum fondasi Task 9 melonggarkan
  // Contact.phone jadi nullable, baris seperti ini mustahil dibuat sama sekali.
  it('membuat Contact tanpa nomor telepon saat identitas belum ada', async () => {
    mockPrisma.channelIdentity.findUnique.mockResolvedValue(null as never)
    await ingestMessengerPayload(payload, 'FACEBOOK')
    const arg = mockPrisma.contact.create.mock.calls[0][0] as { data: { phone: string | null } }
    expect(arg.data.phone ?? null).toBeNull()
  })

  // Pesan KEDUA dari pengirim yang sama tidak boleh melahirkan Contact baru. Tanpa penjaga
  // ini, satu pelanggan yang mengirim 50 pesan meninggalkan 49 baris Contact yatim yang
  // menumpuk di halaman Kontak, dan sampahnya baru kelihatan setelah pelanggan sungguhan
  // mulai menulis -- saat pembersihannya sudah harus manual dan memilah.
  it('memakai kontak yang sudah tertaut saat identitas sudah ada', async () => {
    mockPrisma.channelIdentity.findUnique.mockResolvedValue({ contactId: 'contact_lama' } as never)

    await ingestMessengerPayload(payload, 'FACEBOOK')

    expect(mockPrisma.contact.create).not.toHaveBeenCalled()
    expect(upsertChannelIdentity).toHaveBeenCalledWith(
      expect.objectContaining({ contactId: 'contact_lama' }),
    )
  })

  // externalId Meta ditulis ke kolom Message.externalId yang @unique -- kolom yang sama
  // dipakai WhatsApp. Tanpa ini, Meta yang mengirim ulang webhook (hal normal) akan
  // menggandakan pesan di layar agen.
  it('melewati pesan yang sudah pernah masuk', async () => {
    mockPrisma.message.findUnique.mockResolvedValue({ id: 'msg_fb_1' } as never)
    const result = await ingestMessengerPayload(payload, 'FACEBOOK')
    expect(result).toEqual({ processed: 0, skipped: 1 })
    expect(mockPrisma.message.create).not.toHaveBeenCalled()
  })

  // Echo adalah salinan pesan yang KITA kirim, dipantulkan balik oleh Meta. Kalau ikut
  // diproses sebagai pesan masuk, bot akan menjawab dirinya sendiri.
  it('mengabaikan echo pesan kita sendiri', async () => {
    const echo: MessengerWebhookPayload = {
      object: 'page',
      entry: [{ id: 'page_1', time: 1, messaging: [{
        sender: { id: 'page_1' }, recipient: { id: 'psid_abc' }, timestamp: 1,
        message: { mid: 'm_echo', text: 'balasan kami', is_echo: true },
      }] }],
    }
    const result = await ingestMessengerPayload(echo, 'FACEBOOK')
    expect(result).toEqual({ processed: 0, skipped: 1 })
    expect(mockPrisma.message.create).not.toHaveBeenCalled()
  })

  it('mengunci benang dengan externalThreadId kosong (satu akun = satu percakapan)', async () => {
    await ingestMessengerPayload(payload, 'FACEBOOK')
    const arg = mockPrisma.conversation.upsert.mock.calls[0][0]
    expect(arg.where).toEqual({
      channelIdentityId_externalThreadId: { channelIdentityId: 'ci_fb_1', externalThreadId: '' },
    })
  })
})
