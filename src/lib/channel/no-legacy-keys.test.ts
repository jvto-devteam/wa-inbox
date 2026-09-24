import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Penjaga lintas-repo, bukan test unit.
 *
 * Task 9 melepas Contact.phone @unique dan Conversation.contactId @unique. Prisma menolak
 * field non-unik di `where` sebuah upsert, jadi setiap pemakaian yang tersisa berhenti
 * dikompilasi begitu migrasi itu jalan. Cakupan Task 5b ditentukan dengan menggeledah satu
 * file dan meleset enam call site di tiga file -- test ini ada supaya kesalahan itu tidak
 * bisa terulang diam-diam.
 */
function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p))
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(p)
  }
  return out
}

describe('tidak ada lagi upsert berkunci lama di seluruh repo', () => {
  it('nol contact.upsert({ where: { phone } }) dan conversation.upsert({ where: { contactId } })', () => {
    const offenders: string[] = []

    for (const file of sourceFiles('src')) {
      const src = readFileSync(file, 'utf8')
      if (/contact\.upsert\(\s*\{[\s\S]{0,120}?where:\s*\{\s*phone/.test(src)) {
        offenders.push(`${file}: contact.upsert({ where: { phone } })`)
      }
      if (/conversation\.upsert\(\s*\{[\s\S]{0,120}?where:\s*\{\s*contactId/.test(src)) {
        offenders.push(`${file}: conversation.upsert({ where: { contactId } })`)
      }
    }

    expect(offenders).toEqual([])
  })
})
