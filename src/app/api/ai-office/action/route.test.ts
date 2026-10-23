import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/get-session', () => ({ getSession: vi.fn() }))
const describeAction = vi.fn()
const runAction = vi.fn()
vi.mock('@/lib/ai-office/activity', async (orig) => ({ ...(await orig<typeof import('@/lib/ai-office/activity')>()), reportAiActivity: vi.fn() }))
vi.mock('@/lib/ai-office/agent-tools', async () => {
  const { z } = await import('zod')
  return {
    AGENT_PROFILES: { topik: { name: 'Cahyo' }, bot: { name: 'Tarjo' }, booking: { name: 'Samsul' }, ringkasan: { name: 'Asep' } },
    findAction: (name: string) =>
      name === 'ringkas_ulang'
        ? { name, owner: 'ringkasan', activity: 'Meringkas ulang chat', args: z.object({ conversationId: z.string().min(1) }), describe: describeAction, run: runAction }
        : undefined,
  }
})

import { getSession } from '@/lib/auth/get-session'
import { reportAiActivity } from '@/lib/ai-office/activity'
import { POST } from './route'

const req = (body: unknown) => new Request('http://localhost/api/ai-office/action', { method: 'POST', body: JSON.stringify(body) })

beforeEach(() => {
  vi.mocked(getSession).mockResolvedValue({ accountId: 'a1', role: 'AGENT' } as never)
  describeAction.mockReset().mockResolvedValue({ ok: true, summary: 'Ringkas ulang chat David' })
  runAction.mockReset().mockResolvedValue({ result: 'Ringkasan diperbarui.', conversationId: 'c1' })
})

describe('POST /api/ai-office/action', () => {
  it('401 tanpa sesi', async () => {
    vi.mocked(getSession).mockResolvedValueOnce(null)
    expect((await POST(req({ agent: 'ringkasan', action: 'ringkas_ulang', args: { conversationId: 'c1' } }))).status).toBe(401)
  })

  it('aksi yang tidak dikenal ditolak 400', async () => {
    const res = await POST(req({ agent: 'topik', action: 'hapus_semua', args: { conversationId: 'c1' } }))
    expect(res.status).toBe(400)
    expect(runAction).not.toHaveBeenCalled()
  })

  it('args tidak valid ditolak 400', async () => {
    expect((await POST(req({ agent: 'ringkasan', action: 'ringkas_ulang', args: {} }))).status).toBe(400)
    expect(runAction).not.toHaveBeenCalled()
  })

  it('sasaran diperiksa ulang: kalau sudah tidak bisa, 409 tanpa menjalankan', async () => {
    describeAction.mockResolvedValueOnce({ ok: false, error: 'Chat tidak ditemukan' })
    const res = await POST(req({ agent: 'ringkasan', action: 'ringkas_ulang', args: { conversationId: 'c1' } }))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'Chat tidak ditemukan' })
    expect(runAction).not.toHaveBeenCalled()
  })

  it('menjalankan aksi atas nama akun yang login', async () => {
    const res = await POST(req({ agent: 'ringkasan', action: 'ringkas_ulang', args: { conversationId: 'c1' } }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ result: 'Ringkasan diperbarui.', conversationId: 'c1' })
    expect(runAction).toHaveBeenCalledWith({ conversationId: 'c1' }, expect.objectContaining({ accountId: 'a1', isAdmin: false }))
  })

  it('diperintah lewat asisten lain: pemilik aksi yang bekerja, peminta tercatat meminta', async () => {
    vi.mocked(reportAiActivity).mockClear()
    const res = await POST(req({ agent: 'booking', action: 'ringkas_ulang', args: { conversationId: 'c1' } }))
    expect(await res.json()).toEqual({ result: 'Asep: Ringkasan diperbarui.', conversationId: 'c1' })
    expect(reportAiActivity).toHaveBeenCalledWith('booking', 'selesai', 'Meminta Asep: Meringkas ulang chat', 'c1')
    expect(reportAiActivity).toHaveBeenCalledWith('ringkasan', 'mulai', 'Meringkas ulang chat', 'c1')
    expect(reportAiActivity).toHaveBeenCalledWith('ringkasan', 'selesai', 'Selesai: Meringkas ulang chat', 'c1', true)
  })
})
