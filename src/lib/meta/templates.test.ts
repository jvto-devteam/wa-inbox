import { describe, it, expect, vi, beforeEach } from 'vitest'
import { submitMetaTemplate } from './templates'

beforeEach(() => vi.stubGlobal('fetch', vi.fn()))

describe('submitMetaTemplate', () => {
  it('posts to the WABA message_templates endpoint', async () => {
    ;(fetch as any).mockResolvedValue({ ok: true, json: async () => ({ id: 'tpl_meta_1', status: 'PENDING' }) })

    const result = await submitMetaTemplate(
      { wabaId: 'waba_1', accessToken: 'tok' },
      { name: 'booking_confirmation', category: 'UTILITY', body: 'Booking Anda {{1}} sudah dikonfirmasi.', variables: ['nama'] }
    )

    expect(result).toEqual({ metaId: 'tpl_meta_1', status: 'PENDING' })
    expect(fetch).toHaveBeenCalledWith('https://graph.facebook.com/v20.0/waba_1/message_templates', expect.objectContaining({ method: 'POST' }))
  })
})
