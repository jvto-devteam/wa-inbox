import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import { Prisma, type PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { upsertChannelIdentity } from '@/lib/channel/identity'
import { fetchMessengerProfileName } from '@/lib/meta/messenger-profile'
import type { MessengerWebhookPayload } from '@/lib/meta/messenger-types'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/channel/identity', () => ({ upsertChannelIdentity: vi.fn() }))
vi.mock('@/lib/realtime', () => ({ broadcast: vi.fn() }))
vi.mock('@/lib/meta/messenger-profile', () => ({ fetchMessengerProfileName: vi.fn() }))

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
  // Default eksplisit: pencarian nama tidak menemukan apa pun. Test lama yang tidak peduli
  // soal nama (mayoritas suite ini) tetap berarti persis seperti sebelum fitur ini ada,
  // bukan "kebetulan lulus" karena diam-diam memanggil Graph API yang tak dimock.
  vi.mocked(fetchMessengerProfileName).mockReset().mockResolvedValue(null)
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

  // Simulasi dua pengiriman webhook `mid` yang sama, benar-benar bersamaan: keduanya lolos
  // findUnique idempotency check (sama-sama melihat null) sebelum salah satu message.create()
  // commit. Constraint @unique DB menolak insert sisi yang kalah dengan P2002 -- fungsi ini
  // wajib menelan itu dan melaporkan skip bersih, bukan melempar keluar dari loop
  // ingestMessengerPayload dan membatalkan sisa pesan di payload webhook yang sama. Pola dan
  // test ini menyalin persis ingestSingleMessage di src/lib/inbound.ts (lihat
  // src/lib/inbound.test.ts:173-191).
  it('menangkap P2002 sebagai skip bersih saat dua create bersamaan bentrok pada externalId', async () => {
    mockPrisma.message.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`externalId`)', {
        code: 'P2002',
        clientVersion: '7.9.0',
      }),
    )

    const result = await ingestMessengerPayload(payload, 'FACEBOOK')

    expect(result).toEqual({ processed: 0, skipped: 1 })
  })

  // Error Prisma lain (bukan P2002) TIDAK boleh ditelan -- itu kegagalan genuine (DB down,
  // dll) yang harus terlihat, bukan disamarkan jadi skip biasa.
  it('melempar ulang error Prisma yang bukan P2002', async () => {
    mockPrisma.message.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Some other DB error', {
        code: 'P2025',
        clientVersion: '7.9.0',
      }),
    )

    await expect(ingestMessengerPayload(payload, 'FACEBOOK')).rejects.toThrow()
  })

  // Pelanggan Facebook yang mengirim hanya foto/stiker tanpa teks TIDAK BOLEH menghasilkan
  // nol jejak. Medianya sendiri sengaja tidak diunduh/disimpan (di luar cakupan perbaikan
  // ini) -- yang wajib terjadi hanyalah pesan tetap tersimpan dengan penanda tipe lampiran
  // yang bisa dibaca manusia, supaya percakapannya muncul di Inbox.
  it('menyimpan lampiran tanpa teks dengan penanda tipenya', async () => {
    const attachmentOnly: MessengerWebhookPayload = {
      object: 'page',
      entry: [{
        id: 'page_1',
        time: 1758000000000,
        messaging: [{
          sender: { id: 'psid_abc' },
          recipient: { id: 'page_1' },
          timestamp: 1758000000000,
          message: { mid: 'm_fb_photo', attachments: [{ type: 'image', payload: { url: 'https://example.com/x.jpg' } }] },
        }],
      }],
    }

    const result = await ingestMessengerPayload(attachmentOnly, 'FACEBOOK')

    expect(result).toEqual({ processed: 1, skipped: 0 })
    const arg = mockPrisma.message.create.mock.calls[0][0] as { data: { content: string | null } }
    expect(arg.data.content).toBe('[Lampiran: image]')
  })

  it('menyimpan lampiran tanpa teks dan tanpa tipe yang dikenal dengan penanda generik', async () => {
    const unknownAttachment: MessengerWebhookPayload = {
      object: 'page',
      entry: [{
        id: 'page_1',
        time: 1758000000000,
        messaging: [{
          sender: { id: 'psid_abc' },
          recipient: { id: 'page_1' },
          timestamp: 1758000000000,
          message: { mid: 'm_fb_unknown', attachments: [{ type: undefined as unknown as string }] },
        }],
      }],
    }

    const result = await ingestMessengerPayload(unknownAttachment, 'FACEBOOK')

    expect(result).toEqual({ processed: 1, skipped: 0 })
    const arg = mockPrisma.message.create.mock.calls[0][0] as { data: { content: string | null } }
    expect(arg.data.content).toBe('[Lampiran]')
  })

  // Event yang benar-benar kosong (tanpa teks DAN tanpa lampiran) tidak membawa apa pun --
  // itu bukan kegagalan, dan tetap harus dilewati seperti sebelumnya.
  it('melewati pesan tanpa teks dan tanpa lampiran', async () => {
    const empty: MessengerWebhookPayload = {
      object: 'page',
      entry: [{
        id: 'page_1',
        time: 1758000000000,
        messaging: [{
          sender: { id: 'psid_abc' },
          recipient: { id: 'page_1' },
          timestamp: 1758000000000,
          message: { mid: 'm_fb_empty' },
        }],
      }],
    }

    const result = await ingestMessengerPayload(empty, 'FACEBOOK')

    expect(result).toEqual({ processed: 0, skipped: 1 })
    expect(mockPrisma.message.create).not.toHaveBeenCalled()
  })

  // Pengirim BARU: nama hasil pencarian Graph API harus tersimpan di Contact DAN diteruskan
  // ke upsertChannelIdentity sebagai displayName, supaya baris identitas ikut membawa nama
  // yang sama tanpa pencarian kedua.
  it('menyimpan nama hasil pencarian pada Contact dan meneruskannya sebagai displayName saat pengirim baru', async () => {
    mockPrisma.channelIdentity.findUnique.mockResolvedValue(null as never)
    vi.mocked(fetchMessengerProfileName).mockResolvedValue('David Setya Ramadhan')

    await ingestMessengerPayload(payload, 'FACEBOOK')

    const createArg = mockPrisma.contact.create.mock.calls[0][0] as { data: { name: string | null } }
    expect(createArg.data.name).toBe('David Setya Ramadhan')
    expect(upsertChannelIdentity).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: 'David Setya Ramadhan' }),
    )
  })

  // Pengirim yang SUDAH DIKENAL tidak boleh memicu satu pun pemanggilan Graph API -- nama
  // hanya perlu dicari sekali, saat Contact-nya lahir. Tanpa penjaga ini, pelanggan yang
  // mengirim 50 pesan memicu 50 panggilan Graph API untuk sesuatu yang jawabannya sudah
  // diketahui sejak pesan pertama.
  it('tidak memanggil pencarian profil sama sekali untuk pengirim yang sudah dikenal', async () => {
    mockPrisma.channelIdentity.findUnique.mockResolvedValue({ contactId: 'contact_lama' } as never)

    await ingestMessengerPayload(payload, 'FACEBOOK')

    expect(fetchMessengerProfileName).not.toHaveBeenCalled()
  })

  // Pencarian nama yang GAGAL TOTAL (melempar, bukan cuma mengembalikan null) tidak boleh
  // menggagalkan ingest. Pesan pelanggan harus tetap masuk, Contact tetap dibuat, hanya
  // dengan name null -- persis seperti sebelum fitur pencarian nama ini ada.
  it('tetap mengingest pesan saat pencarian profil melempar error', async () => {
    mockPrisma.channelIdentity.findUnique.mockResolvedValue(null as never)
    vi.mocked(fetchMessengerProfileName).mockRejectedValue(new Error('Graph API down'))

    const result = await ingestMessengerPayload(payload, 'FACEBOOK')

    expect(result).toEqual({ processed: 1, skipped: 0 })
    const createArg = mockPrisma.contact.create.mock.calls[0][0] as { data: { name: string | null } }
    expect(createArg.data.name ?? null).toBeNull()
  })
})
