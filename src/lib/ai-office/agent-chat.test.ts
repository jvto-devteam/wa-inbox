import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/ai-office/activity', async (orig) => ({ ...(await orig<typeof import('./activity')>()), reportAiActivity: vi.fn() }))
vi.mock('@/lib/send', () => ({ sendMessage: vi.fn() }))

import { prisma } from '@/lib/db'
import { reportAiActivity } from '@/lib/ai-office/activity'
import { sendMessage } from '@/lib/send'
import { buildAgentSystemPrompt, parseModelTurn, runAgentChat } from './agent-chat'

const db = prisma as unknown as DeepMockProxy<PrismaClient>
const ctx = { now: new Date('2026-10-23T01:00:00Z'), isAdmin: true }
const ask = (content: string) => [{ role: 'user' as const, content }]

beforeEach(() => {
  mockReset(db)
  vi.mocked(reportAiActivity).mockClear()
  db.settings.findUnique.mockResolvedValue({ ollamaModel: 'm1' } as never)
})

describe('parseModelTurn', () => {
  it('membaca permintaan alat, jawaban, dan jawaban + usulan', () => {
    expect(parseModelTurn('{"alat":"statistik_bot","args":{}}')).toEqual({ kind: 'tool', name: 'statistik_bot', args: {} })
    expect(parseModelTurn('```json\n{"jawab":"Halo"}\n```')).toEqual({ kind: 'answer', reply: 'Halo', proposal: null })
    expect(parseModelTurn('{"jawab":"Oke","usul":{"aksi":"ringkas_ulang","args":{"conversationId":"c1"}}}')).toEqual({
      kind: 'answer',
      reply: 'Oke',
      proposal: { action: 'ringkas_ulang', args: { conversationId: 'c1' } },
    })
  })

  it('teks bukan JSON dianggap jawaban polos', () => {
    expect(parseModelTurn('Tidak ada data hari ini.')).toEqual({ kind: 'answer', reply: 'Tidak ada data hari ini.', proposal: null })
  })
})

describe('buildAgentSystemPrompt', () => {
  it('setiap asisten hanya mendapat alat dan aksi miliknya', () => {
    const oka = buildAgentSystemPrompt('booking', ctx.now)
    expect(oka).toContain('Oka')
    expect(oka).toContain('- kartu_terbuka')
    expect(oka).toContain('- setujui_kartu')
    expect(oka).not.toContain('- ringkas_ulang')
    const tika = buildAgentSystemPrompt('topik', ctx.now)
    expect(tika).toContain('- label_ulang')
    expect(tika).not.toContain('- setujui_kartu')
  })
})

describe('runAgentChat', () => {
  it('alat baca dijalankan server, hasilnya diumpan balik, lalu jawaban akhir', async () => {
    db.bookingAction.findMany.mockResolvedValue([
      { id: 'k1', type: 'CHANGE', field: 'pickup_time', proposedValue: '05:00', lastError: null, createdAt: ctx.now, conversationId: 'c1', conversation: { contact: { name: 'David', phone: '6282143403501' } } },
    ] as never)
    const llm = vi
      .fn()
      .mockResolvedValueOnce('{"alat":"kartu_terbuka","args":{}}')
      .mockResolvedValueOnce('{"jawab":"Ada 1 kartu: jam jemput David jadi 05:00."}')
    const res = await runAgentChat('booking', ask('Kartu apa yang terbuka?'), ctx, { llm })
    expect(res).toEqual({ reply: 'Ada 1 kartu: jam jemput David jadi 05:00.', proposal: null, used: ['kartu booking terbuka'] })
    const second = llm.mock.calls[1][0] as string
    expect(second).toContain('[HASIL ALAT kartu_terbuka]')
    expect(second).toContain('"kartuId":"k1"')
    // Nomor lengkap tidak pernah dikirim ke model.
    expect(second).not.toContain('6282143403501')
    expect(llm.mock.calls[0][1]).toMatchObject({ model: 'm1' })
    expect(reportAiActivity).toHaveBeenCalledWith('booking', 'mulai', expect.any(String), '')
  })

  it('usulan aksi divalidasi dan diberi kalimat konfirmasi, tetapi TIDAK dijalankan', async () => {
    db.conversation.findUnique.mockResolvedValue({ botEnabled: true, contact: { name: 'David', phone: null } } as never)
    const llm = vi.fn().mockResolvedValue('{"jawab":"Siap, bot dimatikan setelah kamu konfirmasi.","usul":{"aksi":"matikan_bot","args":{"conversationId":"c1"}}}')
    const res = await runAgentChat('bot', ask('Matikan bot di chat David'), ctx, { llm })
    expect(res.proposal).toEqual({ action: 'matikan_bot', args: { conversationId: 'c1' }, summary: 'Matikan bot di chat David' })
    expect(db.conversation.update).not.toHaveBeenCalled()
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('aksi milik asisten lain ditolak: tidak ada usulan', async () => {
    const llm = vi.fn().mockResolvedValue('{"jawab":"Oke","usul":{"aksi":"setujui_kartu","args":{"kartuId":"k1"}}}')
    const res = await runAgentChat('ringkasan', ask('Setujui kartu k1'), ctx, { llm })
    expect(res.proposal).toBeNull()
    expect(res.reply).toContain('di luar tindakan')
  })

  it('alat yang tidak ada dilaporkan ke model, bukan dijalankan', async () => {
    const llm = vi.fn().mockResolvedValueOnce('{"alat":"hapus_semua","args":{}}').mockResolvedValueOnce('{"jawab":"Tidak bisa."}')
    const res = await runAgentChat('topik', ask('Hapus semua'), ctx, { llm })
    expect(res.reply).toBe('Tidak bisa.')
    expect(llm.mock.calls[1][0]).toContain('alat tidak ada')
  })

  it('berhenti sesudah batas langkah alat', async () => {
    db.conversation.findMany.mockResolvedValue([])
    const llm = vi.fn().mockResolvedValue('{"alat":"chat_terakhir","args":{}}')
    const res = await runAgentChat('ringkasan', ask('?'), ctx, { llm })
    expect(llm).toHaveBeenCalledTimes(5)
    expect(res.reply).toContain('terlalu banyak langkah')
  })

  it('simulasi bot ditolak untuk non-admin', async () => {
    const llm = vi.fn().mockResolvedValueOnce('{"alat":"coba_jawab","args":{"pesan":"Is Ijen open?"}}').mockResolvedValueOnce('{"jawab":"x"}')
    await runAgentChat('bot', ask('coba jawab'), { ...ctx, isAdmin: false }, { llm })
    expect(llm.mock.calls[1][0]).toContain('hanya untuk admin')
  })

  it('LLM gagal: aktivitas gagal disiarkan dan galat dilempar ke route', async () => {
    const llm = vi.fn().mockRejectedValue(new Error('timeout'))
    await expect(runAgentChat('topik', ask('hai'), ctx, { llm })).rejects.toThrow('timeout')
    expect(reportAiActivity).toHaveBeenCalledWith('topik', 'gagal', expect.any(String), '')
  })
})
