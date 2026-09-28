import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import { Prisma, type PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import * as client from './client'
import { ingestGmailMessage } from './ingest'
import { GmailError } from './errors'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('./client', () => ({
  getAccessToken: vi.fn(), invalidateAccessToken: vi.fn(), gmailGetProfile: vi.fn(), gmailListHistory: vi.fn(),
  gmailListMessageIds: vi.fn(), gmailGetMessage: vi.fn(), gmailWatch: vi.fn(),
}))
vi.mock('./ingest', () => ({ ingestGmailMessage: vi.fn() }))

const mockPrisma = prisma as unknown as DeepMockProxy<PrismaClient>
import { syncMailAccount, requestSync, syncAllMailAccounts, __resetSyncStateForTests } from './sync'

const NOW = new Date('2026-09-28T05:00:00Z')
const account = {
  id: 'mail_1', emailAddress: 'hello@javavolcano-touroperator.com', refreshToken: 'rt', historyId: '100',
  watchExpiresAt: new Date('2026-10-03T00:00:00Z'), lastSyncAt: null, lastSyncError: null, createdAt: NOW,
}

beforeEach(() => {
  mockReset(mockPrisma)
  __resetSyncStateForTests()
  vi.stubEnv('GMAIL_PUBSUB_TOPIC', 'projects/p/topics/t')
  mockPrisma.mailAccount.findUniqueOrThrow.mockResolvedValue(account as never)
  mockPrisma.mailAccount.update.mockResolvedValue(account as never)
  mockPrisma.mailAccount.updateMany.mockResolvedValue({ count: 1 } as never)
  vi.mocked(client.getAccessToken).mockReset().mockResolvedValue('at')
  vi.mocked(client.gmailListHistory).mockReset().mockResolvedValue({
    history: [{ messagesAdded: [{ message: { id: 'gm_1', threadId: 't' } }, { message: { id: 'gm_2', threadId: 't' } }] }],
    historyId: '150',
  })
  vi.mocked(client.gmailGetMessage).mockReset().mockImplementation(async (_t, id) => ({ id, threadId: 't' }))
  vi.mocked(client.gmailGetProfile).mockReset().mockResolvedValue({ emailAddress: account.emailAddress, historyId: '900' })
  vi.mocked(client.gmailListMessageIds).mockReset().mockResolvedValue(['gm_old'])
  vi.mocked(client.gmailWatch).mockReset().mockResolvedValue({ historyId: '150', expiration: String(Date.parse('2026-10-05T05:00:00Z')) })
  vi.mocked(ingestGmailMessage).mockReset().mockResolvedValue('created')
})
afterEach(() => vi.unstubAllEnvs())

describe('syncMailAccount', () => {
  it('meng-ingest setiap email baru dan memajukan kursor secara optimistic', async () => {
    const result = await syncMailAccount('mail_1', NOW)

    expect(result).toMatchObject({ ingested: 2, skipped: 0, error: null })
    expect(mockPrisma.mailAccount.updateMany).toHaveBeenCalledWith({
      where: { id: 'mail_1', historyId: '100' }, data: { historyId: '150' },
    })
    expect(mockPrisma.mailAccount.update).toHaveBeenLastCalledWith({
      where: { id: 'mail_1' }, data: { lastSyncAt: NOW, lastSyncError: null },
    })
  })

  it('email yang sama muncul di dua entri history hanya diambil sekali', async () => {
    vi.mocked(client.gmailListHistory).mockResolvedValue({
      history: [{ messagesAdded: [{ message: { id: 'gm_1', threadId: 't' } }] }, { messagesAdded: [{ message: { id: 'gm_1', threadId: 't' } }] }],
      historyId: '150',
    })
    await syncMailAccount('mail_1', NOW)
    expect(client.gmailGetMessage).toHaveBeenCalledTimes(1)
  })

  it('mengikuti nextPageToken sampai habis', async () => {
    vi.mocked(client.gmailListHistory)
      .mockResolvedValueOnce({ history: [{ messagesAdded: [{ message: { id: 'gm_1', threadId: 't' } }] }], nextPageToken: 'p2', historyId: '150' })
      .mockResolvedValueOnce({ history: [{ messagesAdded: [{ message: { id: 'gm_2', threadId: 't' } }] }], historyId: '160' })
    const result = await syncMailAccount('mail_1', NOW)
    expect(result.ingested).toBe(2)
    expect(mockPrisma.mailAccount.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { historyId: '160' } }))
  })

  it('kursor kedaluwarsa: ambil kursor profil DULU, lalu pulihkan 7 hari terakhir', async () => {
    vi.mocked(client.gmailListHistory).mockRejectedValue(new GmailError('HISTORY_EXPIRED', 'x', 404))
    const result = await syncMailAccount('mail_1', NOW)

    expect(client.gmailListMessageIds).toHaveBeenCalledWith('at', 'newer_than:7d -in:spam -in:trash -in:drafts')
    const profileOrder = vi.mocked(client.gmailGetProfile).mock.invocationCallOrder[0]
    const listOrder = vi.mocked(client.gmailListMessageIds).mock.invocationCallOrder[0]
    expect(profileOrder).toBeLessThan(listOrder)
    expect(result.error).toBeNull()
    expect(mockPrisma.mailAccount.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { historyId: '900' } }))
  })

  it('historyId null: hanya pasang kursor dari profil, tidak meng-ingest apa pun', async () => {
    mockPrisma.mailAccount.findUniqueOrThrow.mockResolvedValue({ ...account, historyId: null } as never)
    await syncMailAccount('mail_1', NOW)
    expect(client.gmailListHistory).not.toHaveBeenCalled()
    expect(ingestGmailMessage).not.toHaveBeenCalled()
    expect(mockPrisma.mailAccount.updateMany).toHaveBeenCalledWith({ where: { id: 'mail_1', historyId: null }, data: { historyId: '900' } })
  })

  it('satu email gagal: sisanya tetap diproses, kursor TIDAK maju, error INGEST_FAILED, watch tetap diperpanjang', async () => {
    mockPrisma.mailAccount.findUniqueOrThrow.mockResolvedValue({ ...account, watchExpiresAt: null } as never)
    vi.mocked(ingestGmailMessage).mockRejectedValueOnce(new Error('db down')).mockResolvedValueOnce('created')
    const result = await syncMailAccount('mail_1', NOW)
    expect(result).toMatchObject({ ingested: 1, error: 'INGEST_FAILED' })
    expect(mockPrisma.mailAccount.updateMany).not.toHaveBeenCalled()
    expect(client.gmailWatch).toHaveBeenCalled()
    expect(mockPrisma.mailAccount.update).toHaveBeenLastCalledWith({ where: { id: 'mail_1' }, data: { lastSyncError: 'INGEST_FAILED' } })
  })

  it('refresh token dicabut: AUTH_REVOKED tercatat, lastSyncAt tidak ditimpa', async () => {
    vi.mocked(client.getAccessToken).mockRejectedValue(new GmailError('AUTH_REVOKED', 'invalid_grant', 400))
    const result = await syncMailAccount('mail_1', NOW)
    expect(result.error).toBe('AUTH_REVOKED')
    expect(mockPrisma.mailAccount.update).toHaveBeenLastCalledWith({ where: { id: 'mail_1' }, data: { lastSyncError: 'AUTH_REVOKED' } })
  })

  it('401 dari Gmail membuang access token dari cache', async () => {
    vi.mocked(client.gmailListHistory).mockRejectedValue(new GmailError('UNAUTHORIZED', 'x', 401))
    const result = await syncMailAccount('mail_1', NOW)
    expect(result.error).toBe('GMAIL_HTTP')
    expect(client.invalidateAccessToken).toHaveBeenCalledWith('mail_1')
  })

  it('watch diperpanjang kalau sisa umurnya kurang dari 24 jam', async () => {
    mockPrisma.mailAccount.findUniqueOrThrow.mockResolvedValue({ ...account, watchExpiresAt: new Date('2026-09-28T20:00:00Z') } as never)
    await syncMailAccount('mail_1', NOW)
    expect(client.gmailWatch).toHaveBeenCalledWith('at', 'projects/p/topics/t')
    expect(mockPrisma.mailAccount.update).toHaveBeenCalledWith({
      where: { id: 'mail_1' }, data: { watchExpiresAt: new Date('2026-10-05T05:00:00Z') },
    })
  })

  it('watch yang masih panjang umurnya tidak disentuh', async () => {
    await syncMailAccount('mail_1', NOW)
    expect(client.gmailWatch).not.toHaveBeenCalled()
  })

  it('tanpa GMAIL_PUBSUB_TOPIC: mode tarik-saja, bukan error', async () => {
    vi.stubEnv('GMAIL_PUBSUB_TOPIC', '')
    mockPrisma.mailAccount.findUniqueOrThrow.mockResolvedValue({ ...account, watchExpiresAt: null } as never)
    const result = await syncMailAccount('mail_1', NOW)
    expect(client.gmailWatch).not.toHaveBeenCalled()
    expect(result.error).toBeNull()
  })

  it('watch gagal: WATCH_FAILED, tapi email tetap tersinkron dan kursor tetap maju', async () => {
    mockPrisma.mailAccount.findUniqueOrThrow.mockResolvedValue({ ...account, watchExpiresAt: null } as never)
    vi.mocked(client.gmailWatch).mockRejectedValue(new GmailError('HTTP', 'x', 403))
    const result = await syncMailAccount('mail_1', NOW)
    expect(result).toMatchObject({ ingested: 2, error: 'WATCH_FAILED' })
    expect(mockPrisma.mailAccount.updateMany).toHaveBeenCalled()
  })

  // Temuan review 1: log kegagalan per-email lama hanya mencatat `kind` (kategori GmailError).
  // Error Prisma (misalnya 22021 byte NUL yang lolos ke DB) bukan GmailError, jadi `kind`-nya
  // selalu 'unknown' -- tidak ada cara melacak sebabnya tanpa membuka `message` mentah, yang
  // dilarang (bisa memuat isi email).
  it('email gagal karena error Prisma dicatat dengan name DAN code, tanpa pesan mentah', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const prismaError = new Prisma.PrismaClientKnownRequestError(
      'Isi email rahasia pelanggan bocor di sini kalau dicetak', { code: '22021', clientVersion: 'x' },
    )
    vi.mocked(ingestGmailMessage).mockRejectedValueOnce(prismaError).mockResolvedValueOnce('created')

    await syncMailAccount('mail_1', NOW)

    const call = consoleError.mock.calls.find((c) => c[0] === 'syncMailAccount: satu email gagal diproses')
    expect(call?.[1]).toMatchObject({ name: 'PrismaClientKnownRequestError', code: '22021' })
    expect(JSON.stringify(call)).not.toContain('Isi email rahasia')
    consoleError.mockRestore()
  })

  it('email gagal karena error biasa (bukan Prisma) dicatat dengan name, tanpa field code', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(ingestGmailMessage).mockRejectedValueOnce(new TypeError('boom')).mockResolvedValueOnce('created')

    await syncMailAccount('mail_1', NOW)

    const call = consoleError.mock.calls.find((c) => c[0] === 'syncMailAccount: satu email gagal diproses')
    expect(call?.[1]).toMatchObject({ name: 'TypeError' })
    expect(call?.[1]).not.toHaveProperty('code')
    consoleError.mockRestore()
  })
})

describe('requestSync (single-flight)', () => {
  it('bel yang berbunyi saat sinkronisasi berjalan memicu SATU putaran ulang, bukan dua', async () => {
    let release: () => void = () => {}
    vi.mocked(client.getAccessToken).mockImplementationOnce(() => new Promise((r) => { release = () => r('at') }))

    const first = requestSync('mail_1')
    const second = requestSync('mail_1')
    const third = requestSync('mail_1')
    expect(second).toBe(first)
    expect(third).toBe(first)

    // getAccessToken baru dipanggil setelah findUniqueOrThrow selesai (microtask); release()
    // sebelum itu masih no-op dan test menggantung.
    await vi.waitFor(() => expect(client.getAccessToken).toHaveBeenCalled())
    release()
    await first
    expect(mockPrisma.mailAccount.findUniqueOrThrow).toHaveBeenCalledTimes(2)
  })

  // Temuan review 4b: `syncMailAccount` bisa melempar SEBELUM baris `while(rerunRequested...)`
  // pernah tercapai (di sini: `findUniqueOrThrow` gagal). Tanpa membersihkan `rerunRequested`
  // di `finally`, bel yang berbunyi selagi upaya yang gagal itu berjalan meninggalkan penanda
  // basi -- percobaan BERSIH berikutnya untuk akun yang sama diam-diam mengulang sinkronisasi
  // satu kali ekstra yang tidak pernah diminta siapa pun.
  it('upaya yang gagal tidak menyisakan penanda rerun basi untuk percobaan berikutnya', async () => {
    let reject: (error: Error) => void = () => {}
    mockPrisma.mailAccount.findUniqueOrThrow.mockImplementationOnce(
      (() => new Promise((_r, rj) => { reject = rj })) as never,
    )

    const first = requestSync('mail_1')
    const second = requestSync('mail_1') // menandai rerunRequested selagi 'first' masih berjalan
    expect(second).toBe(first)

    reject(new Error('akun terhapus'))
    await expect(first).rejects.toThrow('akun terhapus')

    mockPrisma.mailAccount.findUniqueOrThrow.mockResolvedValue(account as never)
    await requestSync('mail_1')

    // 1x percobaan pertama (gagal) + 1x percobaan bersih berikutnya. Kalau rerunRequested
    // tidak dibersihkan, percobaan bersih itu diam-diam mengulang jadi 3x total.
    expect(mockPrisma.mailAccount.findUniqueOrThrow).toHaveBeenCalledTimes(2)
  })
})

describe('syncAllMailAccounts', () => {
  it('kegagalan satu kotak surat tidak menghentikan yang lain', async () => {
    mockPrisma.mailAccount.findMany.mockResolvedValue([{ id: 'mail_1' }, { id: 'mail_2' }] as never)
    mockPrisma.mailAccount.findUniqueOrThrow.mockImplementation((async (args: { where: { id: string } }) =>
      ({ ...account, id: args.where.id, emailAddress: `${args.where.id}@x.com` })) as never)
    vi.mocked(client.getAccessToken)
      .mockRejectedValueOnce(new GmailError('AUTH_REVOKED', 'x', 400))
      .mockResolvedValueOnce('at')

    const results = await syncAllMailAccounts()
    expect(results.map((r) => r.error)).toEqual(['AUTH_REVOKED', null])
  })

  // Temuan review 4a: sebelumnya `syncAllMailAccounts` tidak membungkus `requestSync` sama
  // sekali -- lemparan MENTAH dari satu akun (misalnya `findUniqueOrThrow` gagal karena akunnya
  // baru saja dihapus) menghentikan `for` dan kotak surat berikutnya di daftar tidak pernah
  // disinkronkan.
  it('lemparan MENTAH (bukan SyncResult.error) dari satu kotak surat tidak menghentikan yang lain', async () => {
    mockPrisma.mailAccount.findMany.mockResolvedValue([
      { id: 'mail_bad', emailAddress: 'bad@x.com' },
      { id: 'mail_2', emailAddress: 'mail_2@x.com' },
    ] as never)
    mockPrisma.mailAccount.findUniqueOrThrow.mockImplementation((async (args: { where: { id: string } }) => {
      if (args.where.id === 'mail_bad') throw new Error('akun terhapus')
      return { ...account, id: args.where.id, emailAddress: `${args.where.id}@x.com` }
    }) as never)

    const results = await syncAllMailAccounts()

    expect(results).toEqual([
      { accountId: 'mail_bad', emailAddress: 'bad@x.com', ingested: 0, skipped: 0, error: 'GMAIL_HTTP' },
      expect.objectContaining({ accountId: 'mail_2', error: null }),
    ])
  })
})
