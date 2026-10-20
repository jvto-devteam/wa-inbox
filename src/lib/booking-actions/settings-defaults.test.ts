/** @vitest-environment node */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()

describe('default setelan persetujuan booking (keputusan owner 2026-10-20)', () => {
  it('ketiga kolom Settings default ALWAYS di skema', () => {
    const schema = readFileSync(join(root, 'prisma/schema.prisma'), 'utf8')
    for (const col of ['bookingLightApproval', 'bookingBaliApproval', 'dataRequestApproval']) {
      expect(schema).toMatch(new RegExp(`${col}\\s+String\\s+@default\\("ALWAYS"\\)`))
    }
  })

  it('migrasinya hanya tiga ADD COLUMN Settings dengan default ALWAYS', () => {
    const sql = readFileSync(join(root, 'prisma/migrations/20261020120000_booking_approval_settings/migration.sql'), 'utf8')
    expect(sql.startsWith('-- ')).toBe(true)
    expect(sql.match(/DEFAULT 'ALWAYS'/g)).toHaveLength(3)
    expect(sql).not.toMatch(/APPROVE|CREATE TABLE|DROP/)
  })
})
