import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/realtime', () => ({ broadcast: vi.fn() }))

import { broadcast } from '@/lib/realtime'
import { reportAiActivity } from './activity'

afterEach(() => vi.mocked(broadcast).mockReset())

describe('reportAiActivity', () => {
  it('menyiarkan ai.activity berlabel pendek; deliver hanya bila diminta', () => {
    reportAiActivity('ringkasan', 'selesai', 'Ringkasan diperbarui', 'c1', true)
    expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({ type: 'ai.activity', agent: 'ringkasan', state: 'selesai', label: 'Ringkasan diperbarui', conversationId: 'c1', deliver: true }))
    reportAiActivity('topik', 'mulai', 'Memberi label', 'c2')
    expect(vi.mocked(broadcast).mock.calls[1][0]).not.toHaveProperty('deliver')
  })

  it('siaran yang melempar tidak pernah menggagalkan pekerjaan aslinya', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(broadcast).mockImplementation(() => {
      throw new Error('listener mati')
    })
    expect(() => reportAiActivity('booking', 'gagal', 'x', 'c1')).not.toThrow()
  })
})
