import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import { loadCatalog } from './catalog'

// NOTE: bare `vi.mock('fs')` (per the task brief) does not automock the
// built-in `fs` module's methods in this environment (Vitest 4.1.10 /
// Node 25.2.1) — `fs.existsSync` etc. remain the real implementations
// instead of `vi.fn()`s. This is a known Vitest limitation for built-in
// modules (see https://vitest.dev/guide/mocking/file-system.html), so we
// use an explicit factory to force real mock functions while keeping the
// test's behavior and assertions identical to the brief.
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs')
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: vi.fn(),
      readdirSync: vi.fn(),
      readFileSync: vi.fn(),
    },
    existsSync: vi.fn(),
    readdirSync: vi.fn(),
    readFileSync: vi.fn(),
  }
})

describe('loadCatalog', () => {
  beforeEach(() => vi.clearAllMocks())

  it('reads and merges package JSON files from catalog/', () => {
    ;(fs.existsSync as any).mockReturnValue(true)
    ;(fs.readdirSync as any).mockReturnValue(['ijen.json'])
    ;(fs.readFileSync as any).mockImplementation((p: string) =>
      p.endsWith('ijen.json')
        ? JSON.stringify([{ packageKey: 'ijen-1d', destination: 'Ijen', title: 'Ijen Blue Fire 1D', priceIdr: 850000, inclusions: ['guide', 'transport'], policyNotes: [], links: {} }])
        : '{}'
    )

    const catalog = loadCatalog()

    expect(catalog.packages).toHaveLength(1)
    expect(catalog.packages[0].packageKey).toBe('ijen-1d')
  })

  it('returns an empty catalog when catalog/ has not been synced yet', () => {
    ;(fs.existsSync as any).mockReturnValue(false)
    const catalog = loadCatalog()
    expect(catalog.packages).toEqual([])
    expect(catalog.syncedAt).toBeNull()
  })
})
