/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/bot/llm', () => ({ callLLM: vi.fn() }))

import { callLLM } from '@/lib/bot/llm'
import { buildReviewPrompt, parseReview, reviewConversation } from './review'

const valid = {
  status: 'perlu_tindakan',
  alasan: 'Pelanggan menanyakan harga dan belum dijawab.',
  jenisKontak: 'calon_tamu',
  topik: 'Paket Ijen',
  pertanyaan: ['Berapa harga untuk 2 orang?'],
  poinPenting: ['3 Oktober', '2 orang'],
  statusAgen: 'Belum ada balasan.',
  langkahBerikut: 'Kirim harga paket Ijen 2 orang.',
}

beforeEach(() => {
  vi.mocked(callLLM).mockReset()
})

describe('parseReview', () => {
  it('menerima JSON valid, juga yang dibungkus code fence', () => {
    expect(parseReview(JSON.stringify(valid))).toEqual(valid)
    expect(parseReview('```json\n' + JSON.stringify(valid) + '\n```')?.status).toBe('perlu_tindakan')
  })

  it.each([
    ['bukan JSON', 'Ringkasan: pelanggan tanya harga'],
    ['status di luar enum', JSON.stringify({ ...valid, status: 'urgent' })],
    ['field hilang', JSON.stringify({ status: 'selesai' })],
  ])('menolak %s', (_label, raw) => {
    expect(parseReview(raw)).toBeNull()
  })

  it('membatasi array ke 5 item', () => {
    const many = { ...valid, pertanyaan: ['1', '2', '3', '4', '5', '6', '7'] }
    expect(parseReview(JSON.stringify(many))?.pertanyaan).toHaveLength(5)
  })
})

describe('reviewConversation', () => {
  it('memakai model yang diberikan dan timeout panjang', async () => {
    vi.mocked(callLLM).mockResolvedValue(JSON.stringify(valid))
    await reviewConversation('[21/09 09.05] Pelanggan: halo', ['unreplied'], 'gemma4:31b-cloud')
    const [, opts] = vi.mocked(callLLM).mock.calls[0]
    expect(opts).toMatchObject({ model: 'gemma4:31b-cloud', timeoutMs: 60_000 })
  })

  it('timeout atau error → null, tidak melempar', async () => {
    vi.mocked(callLLM).mockImplementation(async () => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError')
    })
    const review = await reviewConversation('x', ['active'], undefined)
    expect(review).toBeNull()
  })

  it('output rusak → null', async () => {
    vi.mocked(callLLM).mockResolvedValue('maaf, saya tidak bisa')
    await expect(reviewConversation('x', ['active'], undefined)).resolves.toBeNull()
  })
})

describe('buildReviewPrompt', () => {
  it('menyebut alasan kandidat dan hanya memuat transkrip yang diberikan', () => {
    const prompt = buildReviewPrompt('[21/09 09.05] Pelanggan: ok thanks', ['dormant', 'active'])
    expect(prompt).toContain('pelanggan belum menjawab selama beberapa hari')
    expect(prompt).toContain('Pelanggan: ok thanks')
    expect(prompt).not.toMatch(/\+?62\d{8,}/)
  })
})
