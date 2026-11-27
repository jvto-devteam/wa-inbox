/**
 * Pesan WhatsApp TANPA nomor HP (pengguna ber-username; Meta hanya mengirim BSUID). Bentuk payload di bawah diambil dari
 * log produksi 27 Nov 2026 (nama kolom saja): messages[].from_user_id tanpa `from`, contacts[].user_id tanpa `wa_id`,
 * message_echoes[].to_user_id tanpa `to`. Dulu semuanya dijawab 500 dan pesannya hilang.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { ingestMetaMessage, __resetPendingBurstsForTests, type MetaWebhookPayload } from './inbound'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/bot/orchestrator', () => ({ decideAndRespond: vi.fn() }))
vi.mock('@/lib/send', () => ({ sendMessage: vi.fn() }))
vi.mock('@/lib/realtime', () => ({ broadcast: vi.fn() }))
vi.mock('@/lib/inbox/topic-labels', () => ({ classifyAndStoreTopicLabels: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/inbox/gap-log', () => ({ recordUnsourcedReplyGap: vi.fn() }))
vi.mock('@/lib/inbound-messenger', () => ({ ingestMessengerPayload: vi.fn() }))
vi.mock('@/lib/booking-actions/schedule', () => ({ scheduleBookingExtraction: vi.fn(), runBookingExtractionNow: vi.fn().mockResolvedValue(false) }))

const db = prisma as unknown as DeepMockProxy<PrismaClient>
const BSUID = 'MY.1234567890123456'
const PHONE = '60123456789'

type Row = { id: string; contactId: string; externalId: string; bsuid: string | null }
let identities: Row[]

beforeEach(() => {
  mockReset(db)
  __resetPendingBurstsForTests()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  identities = []
  db.message.findUnique.mockResolvedValue(null)
  db.settings.findUniqueOrThrow.mockResolvedValue({ botAutoReplyAll: true, skipBotForIndonesianNumbers: false, botEnabledWhatsapp: true } as never)
  db.settings.findUnique.mockResolvedValue({ fallbackReply: null, handoffReply: null } as never)
  db.contact.create.mockImplementation(((a: { data: { phone: string | null; name: string | null } }) => Promise.resolve({ id: 'c_new', avatarUrl: 'x', ...a.data })) as never)
  db.contact.update.mockImplementation(((a: { where: { id: string } }) => Promise.resolve({ id: a.where.id, phone: null, name: 'Khairul', avatarUrl: 'x' })) as never)
  db.contact.findUniqueOrThrow.mockImplementation(((a: { where: { id: string } }) => Promise.resolve({ id: a.where.id, phone: null, name: null })) as never)
  db.conversation.upsert.mockResolvedValue({ id: 'conv_1', contactId: 'c_new', botEnabled: false } as never)
  db.message.create.mockResolvedValue({ id: 'msg_new' } as never)
  // Tabel ChannelIdentity kecil di memori: cukup untuk cabang cari-lewat-nomor dan cari-lewat-bsuid.
  db.channelIdentity.findUnique.mockImplementation(((a: { where: { platform_externalId?: { externalId: string }; platform_bsuid?: { bsuid: string } } }) => {
    const w = a.where
    const hit = w.platform_externalId ? identities.find((r) => r.externalId === w.platform_externalId?.externalId) : identities.find((r) => r.bsuid === w.platform_bsuid?.bsuid)
    return Promise.resolve(hit ?? null)
  }) as never)
  db.channelIdentity.create.mockImplementation(((a: { data: Omit<Row, 'id'> }) => {
    const row = { id: `ci_${identities.length + 1}`, ...a.data }
    identities.push(row)
    return Promise.resolve(row)
  }) as never)
  db.channelIdentity.upsert.mockImplementation(((a: { create: Omit<Row, 'id' | 'bsuid'> }) => {
    const existing = identities.find((r) => r.externalId === a.create.externalId)
    if (existing) return Promise.resolve(existing)
    const row = { id: `ci_${identities.length + 1}`, bsuid: null, ...a.create }
    identities.push(row)
    return Promise.resolve(row)
  }) as never)
  db.channelIdentity.update.mockImplementation(((a: { where: { id: string }; data: Partial<Row> }) => {
    const row = identities.find((r) => r.id === a.where.id)
    if (row) Object.assign(row, a.data)
    return Promise.resolve(row)
  }) as never)
  db.channelIdentity.updateMany.mockImplementation(((a: { where: { id: string; bsuid: null }; data: { bsuid: string } }) => {
    const row = identities.find((r) => r.id === a.where.id && r.bsuid === null)
    if (row) row.bsuid = a.data.bsuid
    return Promise.resolve({ count: row ? 1 : 0 })
  }) as never)
  db.contact.updateMany.mockResolvedValue({ count: 1 })
})

const inbound = (m: Record<string, unknown>, c: Record<string, unknown> = { profile: { name: 'Khairul' }, user_id: BSUID }): MetaWebhookPayload =>
  ({ entry: [{ changes: [{ field: 'messages', value: { contacts: [c], messages: [{ id: 'wamid.IN1', timestamp: '1700000000', type: 'text', text: { body: 'Halo' }, ...m }] } }] }] }) as never
const echo = (e: Record<string, unknown>): MetaWebhookPayload =>
  ({ entry: [{ changes: [{ field: 'smb_message_echoes', value: { contacts: [{ profile: { name: 'Khairul' }, user_id: BSUID }], message_echoes: [{ id: 'wamid.EC1', from: '622244788833', timestamp: '1700000000', type: 'text', text: { body: 'Hi!' }, ...e }] } }] }] }) as never

describe('pesan masuk tanpa nomor', () => {
  it('disimpan: kontak tanpa nomor, identitas ber-bsuid, percakapan lahir dengan bot mati', async () => {
    const res = await ingestMetaMessage(inbound({ from_user_id: BSUID }))
    expect(res).toMatchObject({ processed: 1, skipped: 0 })
    expect(db.contact.create).toHaveBeenCalledWith({ data: { phone: null, name: 'Khairul' } })
    expect(identities).toEqual([expect.objectContaining({ externalId: BSUID, bsuid: BSUID, contactId: 'c_new' })])
    expect(db.conversation.upsert.mock.calls[0][0].create).toMatchObject({ botEnabled: false, channelIdentityId: 'ci_1' })
    expect(db.settings.findUniqueOrThrow).not.toHaveBeenCalled()
    expect(db.message.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ externalId: 'wamid.IN1', direction: 'INBOUND', content: 'Halo' }) }))
  })

  it('pesan kedua dari orang yang sama memakai identitas dan kontak yang sama', async () => {
    await ingestMetaMessage(inbound({ from_user_id: BSUID }))
    db.contact.create.mockClear()
    await ingestMetaMessage(inbound({ id: 'wamid.IN2', from_user_id: BSUID }))
    expect(identities).toHaveLength(1)
    expect(db.contact.create).not.toHaveBeenCalled()
    expect(db.contact.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'c_new' } }))
  })

  it('tanpa nomor DAN tanpa bsuid dilewati dan dicatat, tanpa menulis apa pun', async () => {
    const res = await ingestMetaMessage(inbound({}, { profile: { name: 'X' } }))
    expect(res).toMatchObject({ processed: 0, skipped: 1 })
    expect(db.contact.create).not.toHaveBeenCalled()
    expect(db.message.create).not.toHaveBeenCalled()
    expect(console.warn).toHaveBeenCalled()
  })
})

describe('nomor muncul belakangan (owner 2026-11-27)', () => {
  it('identitas tanpa nomor dinaikkan: externalId jadi nomor, Contact.phone diisi, percakapan tetap satu', async () => {
    await ingestMetaMessage(inbound({ from_user_id: BSUID }))
    db.contact.create.mockClear()
    db.conversation.upsert.mockClear()
    await ingestMetaMessage(inbound({ id: 'wamid.IN2', from: PHONE, from_user_id: BSUID }, { profile: { name: 'Khairul' }, wa_id: PHONE, user_id: BSUID }))
    expect(identities).toEqual([expect.objectContaining({ id: 'ci_1', externalId: PHONE, bsuid: BSUID })])
    expect(db.contact.updateMany).toHaveBeenCalledWith({ where: { id: 'c_new', phone: null }, data: { phone: PHONE } })
    expect(db.contact.create).not.toHaveBeenCalled()
    expect(db.conversation.upsert.mock.calls[0][0].where).toEqual({ channelIdentityId_externalThreadId: { channelIdentityId: 'ci_1', externalThreadId: '' } })
  })

  it('setelah dinaikkan, pesan tanpa nomor berikutnya tetap menemukan chat yang sama lewat bsuid', async () => {
    await ingestMetaMessage(inbound({ from_user_id: BSUID }))
    await ingestMetaMessage(inbound({ id: 'wamid.IN2', from: PHONE, from_user_id: BSUID }))
    db.conversation.upsert.mockClear()
    await ingestMetaMessage(inbound({ id: 'wamid.IN3', from_user_id: BSUID }))
    expect(identities).toHaveLength(1)
    expect(db.conversation.upsert.mock.calls[0][0].where).toEqual({ channelIdentityId_externalThreadId: { channelIdentityId: 'ci_1', externalThreadId: '' } })
  })

  it('tamu ber-nomor yang belum punya bsuid: bsuid dicatat supaya kelak yang tanpa nomor masuk ke chat yang sama', async () => {
    identities.push({ id: 'ci_lama', contactId: 'c_lama', externalId: PHONE, bsuid: null })
    await ingestMetaMessage(inbound({ from: PHONE, from_user_id: BSUID }, { profile: { name: 'K' }, wa_id: PHONE, user_id: BSUID }))
    expect(identities).toEqual([expect.objectContaining({ id: 'ci_lama', externalId: PHONE, bsuid: BSUID })])
    db.conversation.upsert.mockClear()
    await ingestMetaMessage(inbound({ id: 'wamid.IN2', from_user_id: BSUID }))
    expect(identities).toHaveLength(1)
    expect(db.conversation.upsert.mock.calls[0][0].where).toEqual({ channelIdentityId_externalThreadId: { channelIdentityId: 'ci_lama', externalThreadId: '' } })
  })

  it('dua identitas untuk orang yang sama (satu tanpa nomor, satu ber-nomor): tidak digabung otomatis, chat ber-nomor dipakai, dicatat di log', async () => {
    identities.push({ id: 'ci_bsuid', contactId: 'c_a', externalId: BSUID, bsuid: BSUID }, { id: 'ci_phone', contactId: 'c_b', externalId: PHONE, bsuid: null })
    await ingestMetaMessage(inbound({ from: PHONE, from_user_id: BSUID }))
    expect(identities.map((r) => r.id)).toEqual(['ci_bsuid', 'ci_phone'])
    expect(db.conversation.upsert.mock.calls[0][0].where).toEqual({ channelIdentityId_externalThreadId: { channelIdentityId: 'ci_phone', externalThreadId: '' } })
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('identitas ganda'), expect.anything())
  })
})

describe('echo balasan tanpa nomor', () => {
  it('echo dengan to_user_id (tanpa to) disimpan sebagai pesan keluar di chat tamu itu', async () => {
    const res = await ingestMetaMessage(echo({ to_user_id: BSUID }))
    expect(res).toMatchObject({ echoed: 1 })
    expect(db.contact.create).toHaveBeenCalledWith({ data: { phone: null, name: null } })
    expect(identities).toEqual([expect.objectContaining({ externalId: BSUID, bsuid: BSUID })])
    expect(db.message.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ externalId: 'wamid.EC1', direction: 'OUTBOUND', sentBy: 'AGENT' }) }))
  })

  it('echo tanpa to dan tanpa to_user_id dilewati', async () => {
    const res = await ingestMetaMessage(echo({}))
    expect(res).toMatchObject({ echoed: 0 })
    expect(db.message.create).not.toHaveBeenCalled()
  })
})
