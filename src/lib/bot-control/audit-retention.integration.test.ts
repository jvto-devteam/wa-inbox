/**
 * @vitest-environment node
 *
 * The one-year retention, driven against rows rather than against a where-clause.
 *
 * The unit test beside this one asserts the FILTER `pruneBotAuditLogs` sends. That catches a
 * typo in the field name and nothing else: `gt` written where `lt` was meant is a perfectly
 * well-formed filter, and it deletes every row EXCEPT the old ones — the exact inverse of the
 * feature, and invisible to a test that only reads the query back.
 *
 * So this one keeps a small store of real rows with real timestamps, applies the filter the way
 * Postgres would, and asserts which rows survive.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Row = { id: string; action: string; createdAt: Date }

const store: { rows: Row[] } = { rows: [] }

const db = {
  botControlAuditLog: {
    deleteMany: async ({ where }: { where: { createdAt: { lt: Date } } }) => {
      const cutoff = where.createdAt.lt
      const survivors = store.rows.filter((row) => !(row.createdAt < cutoff))
      const count = store.rows.length - survivors.length
      store.rows = survivors
      return { count }
    },
  },
}

vi.mock('@/lib/db', () => ({ prisma: db }))

const { pruneBotAuditLogs, AUDIT_RETENTION_MS } = await import('./audit')

const NOW = new Date('2027-09-08T00:00:00.000Z')
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000)

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {})
  store.rows = [
    { id: 'kemarin', action: 'ENABLE', createdAt: daysAgo(1) },
    { id: 'setengah_tahun', action: 'PUBLISH', createdAt: daysAgo(180) },
    // One day inside the window. The boundary is where an off-by-one deletes a year of history.
    { id: 'hampir_setahun', action: 'DISABLE', createdAt: daysAgo(364) },
    { id: 'setahun_lebih_sehari', action: 'PUBLISH', createdAt: daysAgo(366) },
    { id: 'tiga_tahun', action: 'UPDATE', createdAt: daysAgo(3 * 365) },
  ]
})

describe('pruneBotAuditLogs, against rows', () => {
  it('removes what is older than a year and keeps everything younger', async () => {
    const result = await pruneBotAuditLogs(NOW)

    expect(result).toEqual({ deleted: 2 })
    expect(store.rows.map((row) => row.id)).toEqual(['kemarin', 'setengah_tahun', 'hampir_setahun'])
  })

  it('keeps the row that is one day short of the cutoff', async () => {
    await pruneBotAuditLogs(NOW)
    expect(store.rows.some((row) => row.id === 'hampir_setahun')).toBe(true)
  })

  it('is idempotent: a second run deletes nothing and leaves the survivors alone', async () => {
    await pruneBotAuditLogs(NOW)
    const after = store.rows.map((row) => row.id)

    expect(await pruneBotAuditLogs(NOW)).toEqual({ deleted: 0 })
    expect(store.rows.map((row) => row.id)).toEqual(after)
  })

  it('deletes nothing at all when the whole table is younger than the window', async () => {
    store.rows = [{ id: 'baru', action: 'ENABLE', createdAt: daysAgo(2) }]

    expect(await pruneBotAuditLogs(NOW)).toEqual({ deleted: 0 })
    expect(store.rows).toHaveLength(1)
  })

  it('cuts exactly one year back, not some other window', async () => {
    // Pinned so shortening the retention has to be a deliberate edit to the constant, with the
    // history somebody loses spelled out in the same change.
    expect(AUDIT_RETENTION_MS).toBe(365 * 24 * 60 * 60 * 1000)
  })
})
