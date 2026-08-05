import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET } from './route'
import { loadCatalog } from '@/lib/bot/catalog'

vi.mock('@/lib/bot/catalog', () => ({ loadCatalog: vi.fn() }))

beforeEach(() => {
  vi.mocked(loadCatalog).mockReset()
})

describe('GET /api/bot/catalog-summary', () => {
  it('returns syncedAt, packageCount, and a trimmed field set per package', async () => {
    vi.mocked(loadCatalog).mockReturnValue({
      syncedAt: '2026-07-27T10:00:00.000Z',
      packages: [
        {
          packageKey: 'ijen-bromo-3d2n', title: 'Ijen Bromo 3D2N', destinationTokens: ['ijen', 'bromo'],
          priceIdr: 1500000, inclusions: ['Hotel', 'Transport'], policyNotes: ['No refund'], stagingNotes: [], links: {},
          origin: 'Surabaya', dayCount: 3, finishCities: [],
        },
      ],
    })

    const res = await GET()
    const body = await res.json()

    expect(body).toEqual({
      syncedAt: '2026-07-27T10:00:00.000Z',
      packageCount: 1,
      packages: [{ packageKey: 'ijen-bromo-3d2n', title: 'Ijen Bromo 3D2N', destinationTokens: ['ijen', 'bromo'], priceIdr: 1500000 }],
    })
  })

  it('returns an empty summary when the catalog has never been synced', async () => {
    vi.mocked(loadCatalog).mockReturnValue({ syncedAt: null, packages: [] })

    const res = await GET()
    const body = await res.json()

    expect(body).toEqual({ syncedAt: null, packageCount: 0, packages: [] })
  })
})
