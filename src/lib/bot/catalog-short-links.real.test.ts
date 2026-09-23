/**
 * Kunci antara katalog dan daftar redirect Cloudflare (docs/shortlink/bulk-redirects-jvto-me.csv).
 *
 * Link yang dikirim bot ke pelanggan memakai domain pendek jvto.me sejak 2026-09-23. Domain itu
 * TIDAK punya halaman sendiri: setiap slug harus ada di daftar Bulk Redirects, atau di salah satu
 * rule pola (r/, team/, b/). Slug yang tidak terdaftar tidak menghasilkan 404 yang kelihatan —
 * ia menghasilkan halaman error Cloudflare, di tautan yang sudah terlanjur dikirim ke pelanggan.
 *
 * Satu pengecualian yang disengaja:
 * - /assets/... (customer-media-registry.json) tetap panjang: itu berkas gambar yang diunduh
 *   penyedia WhatsApp, bukan halaman yang dibaca orang.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const CATALOG_DIR = join(process.cwd(), 'catalog')
const CSV = join(process.cwd(), 'docs', 'shortlink', 'bulk-redirects-jvto-me.csv')

const catalogFiles = readdirSync(CATALOG_DIR).filter((f) => f.endsWith('.json'))
const readCatalog = (file: string) => readFileSync(join(CATALOG_DIR, file), 'utf8')

const shortSlugs = new Set(
  readFileSync(CSV, 'utf8')
    .trim()
    .split('\n')
    .map((line) => line.split(',')[0].replace(/^jvto\.me/, '').replace(/\/$/, ''))
)

const PATTERN_SLUGS = [/^\/r\/\d+$/, /^\/team\/[a-z-]+$/, /^\/b\/[0-9A-Za-z]{10}$/]

const LONG_URL = /https?:\/\/javavolcano-touroperator\.com([^"\s]*)/g
const SHORT_URL = /https:\/\/jvto\.me([^"\s]*)/g

describe('katalog memakai short link yang benar-benar terdaftar', () => {
  it('setiap URL jvto.me di katalog punya baris di daftar Bulk Redirects atau cocok rule pola', () => {
    const unknown: string[] = []
    for (const file of catalogFiles) {
      for (const [, rest] of readCatalog(file).matchAll(SHORT_URL)) {
        const slug = rest.split('#')[0].split('?')[0].replace(/\/$/, '')
        if (!shortSlugs.has(slug) && !PATTERN_SLUGS.some((p) => p.test(slug))) unknown.push(`${file}: ${slug}`)
      }
    }
    expect(unknown).toEqual([])
  })

  it('setiap public_url relatif menunjuk slug pendek yang terdaftar', () => {
    const unknown: string[] = []
    for (const file of catalogFiles) {
      for (const [, path] of readCatalog(file).matchAll(/"public_url": "([^"]*)"/g)) {
        if (!path.startsWith('/')) continue
        if (!shortSlugs.has(path.replace(/\/$/, ''))) unknown.push(`${file}: ${path}`)
      }
    }
    expect(unknown).toEqual([])
  })

  it('tidak ada lagi URL halaman berdomain panjang di katalog, selain /assets dan legacy_base_url', () => {
    const leftovers: string[] = []
    for (const file of catalogFiles) {
      const body = readCatalog(file)
      for (const match of body.matchAll(LONG_URL)) {
        const path = match[1]
        if (path.startsWith('/assets')) continue
        // Satu-satunya domain panjang yang boleh tersisa: nilai legacy_base_url, yang dipakai
        // membangun links.legacyDetails untuk mengenali URL yang ditempel pelanggan.
        if (path === '' && /"legacy_base_url":\s*"$/.test(body.slice(0, match.index))) continue
        leftovers.push(`${file}: ${path || '/'}`)
      }
    }
    expect(leftovers).toEqual([])
  })

  it('link registry membawa base_url pendek dan legacy_base_url panjang', () => {
    const registry = JSON.parse(readCatalog('customer-link-registry.json'))
    expect(registry.base_url).toBe('https://jvto.me')
    expect(registry.legacy_base_url).toBe('https://javavolcano-touroperator.com')
  })

  it('setiap paket punya public_url pendek DAN legacy_public_url panjang', () => {
    const profiles = JSON.parse(readCatalog('package-profiles.json'))
    const packages = Array.isArray(profiles) ? profiles : profiles.packages
    expect(packages.length).toBeGreaterThan(0)
    for (const pkg of packages) {
      expect(shortSlugs.has(String(pkg.public_url).replace(/\/$/, ''))).toBe(true)
      expect(String(pkg.legacy_public_url)).toMatch(/^\/tours\/from-(?:surabaya|bali)\//)
    }
  })
})
