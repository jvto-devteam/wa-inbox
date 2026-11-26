import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EXCLUSION_NOTE, NON_CONTENT_TYPES, OWED_NOTE } from './exclusion'

/**
 * Pemeriksa mekanis buku aturan antrean (docs/aturan-antrean.md, owner 2026-11-25: "jadikan aturan, jangan cuma diubah").
 * Gagal bila: alasan penutupan di kode tidak tertulis di dokumen (atau sebaliknya), nama simbol yang dirujuk dokumen tidak
 * ada di kode, atau ID aturan ganda. Dengan ini aturan tidak bisa berubah tanpa dokumennya ikut berubah.
 */
const ROOT = join(__dirname, '..', '..', '..')
const doc = readFileSync(join(ROOT, 'docs', 'aturan-antrean.md'), 'utf8')
const code = ['src/lib/summary-items/exclusion.ts', 'src/lib/summary-items/sync.ts', 'src/lib/summary-items/noise.ts', 'src/lib/daily-summary/review.ts', 'src/lib/daily-summary/generate.ts', 'src/lib/daily-summary/payload-schema.ts', 'src/lib/daily-summary/collect.ts', 'src/lib/daily-summary/config.ts', 'scripts/audit-antrean.ts', 'src/lib/new/summary.ts', 'src/app/api/daily-summary/route.ts', 'src/lib/new/report.ts', 'src/app/api/new/report/route.ts']
  .map((p) => readFileSync(join(ROOT, p), 'utf8'))
  .join('\n')

describe('buku aturan antrean = kode', () => {
  it('setiap alasan "tidak masuk antrean" di kode tertulis di dokumen, dan sebaliknya', () => {
    const inCode = Object.keys(EXCLUSION_NOTE).sort()
    const inDoc = [...new Set([...doc.matchAll(/`([A-Z][A-Z_]+)`/g)].map((m) => m[1]))].filter((k) => k in EXCLUSION_NOTE || /^[A-Z]+_[A-Z_]+$/.test(k))
    for (const k of inCode) expect(doc, `alasan ${k} tidak ada di docs/aturan-antrean.md`).toContain('`' + k + '`')
    // Kode berhuruf besar di dokumen harus ada di kode (alasan penutupan atau simbol lain).
    for (const k of inDoc) expect(code, `kode ${k} di dokumen tidak ada di kode`).toContain(k)
  })

  it('simbol yang dirujuk dokumen ada di kode', () => {
    const symbols = [...new Set([...doc.matchAll(/`([a-z][A-Za-z]+|[A-Z][A-Z_]+)`/g)].map((m) => m[1]))]
    expect(symbols.length).toBeGreaterThan(15)
    for (const s of symbols) expect(code, `simbol ${s} di dokumen tidak ada di kode`).toContain(s)
  })

  it('catatan pindahan dan jenis pesan tanpa isi sama persis dengan kode', () => {
    expect(doc).toContain(`"${OWED_NOTE}"`)
    for (const t of NON_CONTENT_TYPES.filter((t) => t !== 'revoke')) {
      const word = { reaction: 'reaction', sticker: 'stiker', edit: 'diedit', unsupported: 'tidak didukung', system: 'sistem' }[t]
      expect(doc, `jenis ${t} tidak dijelaskan`).toContain(word)
    }
    expect(doc).toContain('revoke')
  })

  it('ID aturan unik dan berurutan per bagian', () => {
    const ids = [...doc.matchAll(/^\| (AQ-\d{2}) \|/gm)].map((m) => m[1])
    expect(ids.length).toBeGreaterThanOrEqual(20)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it.each([['AR', 4], ['AL', 5]] as const)('aturan halaman (%s-xx) unik dan masing-masing dirujuk di kode', (prefix, min) => {
    const ids = [...doc.matchAll(new RegExp('^\\| (' + prefix + '-\\d{2}) \\|', 'gm'))].map((m) => m[1])
    expect(ids.length).toBeGreaterThanOrEqual(min)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(code, `aturan ${id} tidak dirujuk di kode`).toContain(id)
  })
})
