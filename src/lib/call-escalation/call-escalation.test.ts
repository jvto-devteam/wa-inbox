/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))

import { prisma } from '@/lib/db'
import { getCallOutcome, placeCall } from './client'
import { STALE_AFTER_MS, WAIT_MS, escalationConfig, type EscalationConfig } from './config'
import { armCallEscalation, runCallEscalations } from './escalate'

const db = prisma as unknown as DeepMockProxy<PrismaClient>
const NOW = new Date('2026-11-27T09:00:00Z')
const ENV = { ESCALATION_CALL_MODE: 'live', ESCALATION_CALL_PHONE: '+62 812-0000-1234', TELEPON_TOKEN: 'rahasia-token-yang-panjang' }
const CFG: EscalationConfig = { phone: '6281200001234', url: 'http://127.0.0.1:3030', token: ENV.TELEPON_TOKEN, mode: 'live' }

describe('escalationConfig', () => {
  it('nomor dinormalkan jadi angka; bawaan telepon-service di VPS yang sama', () => {
    expect(escalationConfig(ENV)).toEqual(CFG)
  })

  it('mati bila mode bukan live/dry, nomor terlalu pendek, atau token kosong', () => {
    expect(escalationConfig({ ...ENV, ESCALATION_CALL_MODE: undefined })).toBeNull()
    expect(escalationConfig({ ...ENV, ESCALATION_CALL_MODE: 'on' })).toBeNull()
    expect(escalationConfig({ ...ENV, ESCALATION_CALL_PHONE: '123' })).toBeNull()
    expect(escalationConfig({ ...ENV, TELEPON_TOKEN: '' })).toBeNull()
    expect(escalationConfig({})).toBeNull()
  })

  it('tunggu 15 menit (owner 2026-11-27), dan tidak ada jam senyap di konfigurasi', () => {
    expect(WAIT_MS).toBe(15 * 60 * 1000)
    expect(Object.keys(escalationConfig(ENV)!)).toEqual(['phone', 'url', 'token', 'mode'])
  })
})

describe('klien telepon-service', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
  afterEach(() => vi.unstubAllGlobals())
  const fetchMock = () => vi.mocked(fetch)

  it('POST /call dengan token Bearer, nomor, rekaman, dan idempotencyKey', async () => {
    fetchMock().mockResolvedValue({ status: 202, ok: true, json: async () => ({ id: 'job1', status: 'queued' }) } as Response)
    expect(await placeCall(CFG, { audio: 'komplain', idempotencyKey: 'wai-1' })).toEqual({ ok: true, jobId: 'job1' })
    const [url, init] = fetchMock().mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://127.0.0.1:3030/call')
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${CFG.token}`)
    expect(JSON.parse(init.body as string)).toEqual({ phone: '6281200001234', audio: 'komplain', idempotencyKey: 'wai-1' })
  })

  it('429 = rateLimited; galat lain / jaringan = gagal; tidak melempar dan tidak membocorkan token', async () => {
    fetchMock().mockResolvedValueOnce({ status: 429, ok: false } as Response)
    expect(await placeCall(CFG, { audio: 'x', idempotencyKey: 'k' })).toEqual({ ok: false, status: 429, rateLimited: true })
    fetchMock().mockResolvedValueOnce({ status: 403, ok: false } as Response)
    expect(await placeCall(CFG, { audio: 'x', idempotencyKey: 'k' })).toEqual({ ok: false, status: 403, rateLimited: false })
    fetchMock().mockRejectedValueOnce(new Error(`koneksi ditolak ${CFG.token}`))
    const r = await placeCall(CFG, { audio: 'x', idempotencyKey: 'k' })
    expect(r).toEqual({ ok: false, status: 'error', rateLimited: false })
    expect(JSON.stringify(r)).not.toContain(CFG.token)
  })

  it('GET /call/:id: selesai + hasil, atau belum selesai', async () => {
    fetchMock().mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'done', result: { outcome: 'completed' } }) } as Response)
    expect(await getCallOutcome(CFG, 'job1')).toEqual({ finished: true, outcome: 'completed' })
    fetchMock().mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'running' }) } as Response)
    expect(await getCallOutcome(CFG, 'job1')).toEqual({ finished: false, outcome: null })
    fetchMock().mockRejectedValueOnce(new Error('x'))
    expect(await getCallOutcome(CFG, 'job1')).toBeNull()
  })
})

describe('armCallEscalation', () => {
  beforeEach(() => {
    mockReset(db)
    vi.stubEnv('ESCALATION_CALL_MODE', '')
  })
  afterEach(() => vi.unstubAllEnvs())
  const enable = () => Object.entries(ENV).forEach(([k, v]) => vi.stubEnv(k, v))

  it('fitur mati = tidak menulis apa pun', async () => {
    await armCallEscalation({ kind: 'REPLY', conversationId: 'c1', itemId: 'i1', anchorAt: NOW }, NOW)
    expect(db.callEscalation.create).not.toHaveBeenCalled()
  })

  it('Balas: kunci per kartu + anchor; masalah: kunci per notif; keduanya ARMED sejak notif terkirim', async () => {
    enable()
    await armCallEscalation({ kind: 'REPLY', conversationId: 'c1', itemId: 'i1', anchorAt: NOW }, NOW)
    await armCallEscalation({ kind: 'PROBLEM', conversationId: 'c2', label: 'komplain' }, NOW)
    expect(db.callEscalation.create).toHaveBeenNthCalledWith(1, { data: { kind: 'REPLY', conversationId: 'c1', triggerKey: `reply:i1:${NOW.getTime()}`, armedAt: NOW, itemId: 'i1', anchorAt: NOW } })
    expect(db.callEscalation.create).toHaveBeenNthCalledWith(2, { data: { kind: 'PROBLEM', conversationId: 'c2', triggerKey: `problem:c2:komplain:${NOW.getTime()}`, armedAt: NOW, label: 'komplain' } })
  })

  it('pemicu yang sama dua kali (P2002) diabaikan; galat lain tidak melempar', async () => {
    enable()
    db.callEscalation.create.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 'P2002' }))
    await expect(armCallEscalation({ kind: 'REPLY', conversationId: 'c1', itemId: 'i1', anchorAt: NOW }, NOW)).resolves.toBeUndefined()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    db.callEscalation.create.mockRejectedValueOnce(new Error('db'))
    await expect(armCallEscalation({ kind: 'REPLY', conversationId: 'c1', itemId: 'i1', anchorAt: NOW }, NOW)).resolves.toBeUndefined()
  })
})

describe('runCallEscalations', () => {
  const armedAt = (minAgo: number) => new Date(NOW.getTime() - minAgo * 60_000)
  const row = (id: string, o: Partial<{ kind: string; itemId: string | null; anchorAt: Date | null; armedAt: Date; conversationId: string }> = {}) => ({
    id, kind: 'REPLY', conversationId: `c-${id}`, itemId: `i-${id}`, anchorAt: armedAt(40), armedAt: armedAt(16), ...o,
  })

  beforeEach(() => {
    mockReset(db)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 202, ok: true, json: async () => ({ id: 'job1' }) } as Response))
    Object.entries(ENV).forEach(([k, v]) => vi.stubEnv(k, v))
    db.callEscalation.updateMany.mockResolvedValue({ count: 1 })
    db.callEscalation.findMany.mockResolvedValueOnce([]) // polling hasil
    db.callEscalation.deleteMany.mockResolvedValue({ count: 0 })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  const dueRows = (rows: ReturnType<typeof row>[]) => db.callEscalation.findMany.mockReset().mockResolvedValueOnce(rows as never).mockResolvedValueOnce([])
  const openItem = (anchorAt: Date) => db.summaryItem.findUnique.mockResolvedValue({ state: 'OPEN', anchorAt } as never)

  it('fitur mati = tidak membaca apa pun', async () => {
    vi.stubEnv('ESCALATION_CALL_MODE', '')
    expect(await runCallEscalations(NOW)).toEqual({ called: 0, dry: 0, resolved: 0, expired: 0, failed: 0 })
    expect(db.callEscalation.findMany).not.toHaveBeenCalled()
  })

  it('hanya yang sudah 15 menit sejak notif diambil', async () => {
    dueRows([])
    await runCallEscalations(NOW)
    expect(db.callEscalation.findMany.mock.calls[0][0]).toMatchObject({ where: { status: 'ARMED', armedAt: { lte: new Date(NOW.getTime() - WAIT_MS) } } })
  })

  it('Balas masih OPEN dengan anchor yang sama = telepon, rekaman "belum-dibalas", ditandai CALLED', async () => {
    const r = row('a')
    dueRows([r])
    openItem(r.anchorAt!)
    expect(await runCallEscalations(NOW)).toMatchObject({ called: 1 })
    expect(db.callEscalation.updateMany).toHaveBeenCalledWith({ where: { id: 'a', status: 'ARMED' }, data: { status: 'CALLING' } })
    expect(JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string)).toEqual({ phone: '6281200001234', audio: 'belum-dibalas', idempotencyKey: 'wai-a' })
    expect(db.callEscalation.update).toHaveBeenCalledWith({ where: { id: 'a' }, data: { status: 'CALLED', jobId: 'job1' } })
  })

  it('Balas sudah ditindak (tidak OPEN / dihapus / anchor berganti) = RESOLVED, tanpa telepon', async () => {
    const r = row('a')
    dueRows([r, row('b'), row('c')])
    db.summaryItem.findUnique
      .mockResolvedValueOnce({ state: 'DONE', anchorAt: r.anchorAt } as never)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ state: 'OPEN', anchorAt: new Date(r.anchorAt!.getTime() + 1) } as never)
    expect(await runCallEscalations(NOW)).toMatchObject({ resolved: 3, called: 0 })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('masalah: ada pesan keluar AGEN sesudah notif = RESOLVED; tanpa itu = telepon rekaman "komplain"', async () => {
    dueRows([row('p1', { kind: 'PROBLEM', itemId: null, anchorAt: null }), row('p2', { kind: 'PROBLEM', itemId: null, anchorAt: null })])
    db.message.findFirst.mockResolvedValueOnce({ id: 'm1' } as never).mockResolvedValueOnce(null)
    expect(await runCallEscalations(NOW)).toMatchObject({ resolved: 1, called: 1 })
    expect(db.message.findFirst).toHaveBeenCalledWith({
      where: { conversationId: 'c-p1', direction: 'OUTBOUND', sentBy: 'AGENT', createdAt: { gt: armedAt(16) } },
      select: { id: true },
    })
    expect(JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string).audio).toBe('komplain')
  })

  it('lewat 1 jam dari jatuh tempo = EXPIRED, tidak menelepon soal yang sudah basi', async () => {
    dueRows([row('old', { armedAt: new Date(NOW.getTime() - WAIT_MS - STALE_AFTER_MS - 1000) })])
    expect(await runCallEscalations(NOW)).toMatchObject({ expired: 1, called: 0 })
    expect(db.callEscalation.update).toHaveBeenCalledWith({ where: { id: 'old' }, data: { status: 'EXPIRED', detail: 'basi' } })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('klaim kalah (tick lain sudah mengambil) = tidak menelepon', async () => {
    const r = row('a')
    dueRows([r])
    openItem(r.anchorAt!)
    db.callEscalation.updateMany.mockResolvedValue({ count: 0 })
    expect(await runCallEscalations(NOW)).toMatchObject({ called: 0 })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('mode dry: dicatat DRY_RUN, tidak menelepon', async () => {
    vi.stubEnv('ESCALATION_CALL_MODE', 'dry')
    const r = row('a')
    dueRows([r])
    openItem(r.anchorAt!)
    expect(await runCallEscalations(NOW)).toMatchObject({ dry: 1, called: 0 })
    expect(db.callEscalation.update).toHaveBeenCalledWith({ where: { id: 'a' }, data: { status: 'DRY_RUN' } })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('batas per jam telepon-service (429) = tetap ARMED, dicoba lagi tick berikutnya; galat lain = FAILED', async () => {
    const r1 = row('a')
    const r2 = row('b')
    dueRows([r1, r2])
    db.summaryItem.findUnique.mockResolvedValue({ state: 'OPEN', anchorAt: r1.anchorAt } as never)
    vi.mocked(fetch).mockResolvedValueOnce({ status: 429, ok: false } as Response).mockResolvedValueOnce({ status: 403, ok: false } as Response)
    expect(await runCallEscalations(NOW)).toMatchObject({ called: 0, failed: 1 })
    expect(db.callEscalation.update).toHaveBeenCalledWith({ where: { id: 'a' }, data: { status: 'ARMED', detail: 'batas per jam telepon-service' } })
    expect(db.callEscalation.update).toHaveBeenCalledWith({ where: { id: 'b' }, data: { status: 'FAILED', detail: 'telepon-service 403' } })
  })

  it('hasil telepon (diangkat / tidak) dicatat; yang belum selesai dibiarkan', async () => {
    db.callEscalation.findMany.mockReset().mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'x', jobId: 'j1' }, { id: 'y', jobId: 'j2' }] as never)
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'done', result: { outcome: 'not_answered' } }) } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'running' }) } as Response)
    await runCallEscalations(NOW)
    expect(db.callEscalation.update).toHaveBeenCalledTimes(1)
    expect(db.callEscalation.update).toHaveBeenCalledWith({ where: { id: 'x' }, data: { outcome: 'not_answered' } })
  })

  it('memangkas yang lebih tua dari 30 hari, dan tidak pernah melempar', async () => {
    dueRows([])
    await runCallEscalations(NOW)
    expect(db.callEscalation.deleteMany).toHaveBeenCalledWith({ where: { armedAt: { lt: new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000) } } })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    db.callEscalation.findMany.mockReset().mockRejectedValue(new Error('db'))
    await expect(runCallEscalations(NOW)).resolves.toEqual({ called: 0, dry: 0, resolved: 0, expired: 0, failed: 0 })
  })
})
