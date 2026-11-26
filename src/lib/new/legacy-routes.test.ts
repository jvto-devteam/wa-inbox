import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LEGACY_REDIRECTS, newPathFor } from './legacy-routes'

// Pemeriksa mekanis permintaan owner 2026-11-26: aplikasi baru di root, tidak ada tautan ke halaman lama yang sudah
// digantikan, dan tidak ada lagi alamat berawalan /new.
const ROOT = join(__dirname, '..', '..', '..')
const APP = join(ROOT, 'src', 'app', '(app)')
const rel = (p: string) => p.slice(ROOT.length + 1)

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && !p.includes('__fixtures__')) out.push(p)
  }
  return out
}

/** Alamat halaman internal yang ditulis kode sebagai tujuan navigasi (href, push, replace, assign, Link). */
function navTargets(src: string): string[] {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  const re = /(?:href=\{?|(?:push|replace|assign)\()\s*[`'"](\/[a-zA-Z][^`'"$?#]*)/g
  return [...code.matchAll(re)].map((m) => m[1].replace(/\/$/, '') || '/')
}

/** Halaman yang ada sekarang (aplikasi baru, halaman lama yang dipertahankan, /login). */
function pageExists(path: string): boolean {
  const segs = path.split('/').filter(Boolean)
  const tryDir = (base: string, rest: string[]): boolean => {
    if (!rest.length) return existsSync(join(base, 'page.tsx'))
    if (existsSync(join(base, rest[0]))) return tryDir(join(base, rest[0]), rest.slice(1))
    const dyn = existsSync(base) ? readdirSync(base).find((d) => /^\[.+\]$/.test(d)) : undefined
    return dyn ? tryDir(join(base, dyn), rest.slice(1)) : false
  }
  return tryDir(APP, segs) || tryDir(join(ROOT, 'src', 'app'), segs)
}

describe('alamat aplikasi', () => {
  it('peta alamat lama -> baru, dan setiap tujuannya halaman yang ada', () => {
    expect(newPathFor('/contacts/abc')).toBe('/kontak/abc')
    expect(newPathFor('/summary')).toBe('/antrean')
    expect(newPathFor('/chatbot')).toBe('/bot/pengaturan')
    expect(newPathFor('/bot-control/knowledge')).toBe('/bot/knowledge')
    expect(newPathFor('/settings/knowledge-gaps')).toBe('/bot/celah')
    expect(newPathFor('/bot-control/decisions')).toBe('/bot/keputusan')
    expect(newPathFor('/new')).toBe('/dashboard')
    expect(newPathFor('/new/inbox')).toBe('/inbox')
    expect(newPathFor('/new/kontak/abc')).toBe('/kontak/abc')
    // alamat yang sama dengan yang baru, dan halaman lama yang dipertahankan, tidak dialihkan
    for (const p of ['/inbox', '/dashboard', '/settings', '/templates', '/bot-control', '/ai-office', '/bot']) expect(newPathFor(p), p).toBeNull()
    for (const r of LEGACY_REDIRECTS) {
      if (r.destination.includes(':path')) continue
      expect(pageExists(r.destination.replace(':id', 'x')), r.destination).toBe(true)
      expect(newPathFor(r.source.replace(':id', 'x')), r.source).toBe(r.destination.replace(':id', 'x'))
    }
  })

  it('kode aplikasi baru tidak menulis alamat /new atau alamat lama yang sudah digantikan, dan tujuannya ada', () => {
    const newPages = ['dashboard', 'inbox', 'antrean', 'ringkasan', 'laporan', 'agent', 'kontak', 'template', 'bot'].map((d) => join(APP, d))
    const files = [...walk(join(ROOT, 'src', 'components', 'new')), ...walk(join(ROOT, 'src', 'lib', 'new')), ...newPages.flatMap((d) => walk(d)), join(APP, 'layout.tsx')]
    const bad = files.flatMap((f) => navTargets(readFileSync(f, 'utf8'))
      .filter((t) => !t.startsWith('/api/') && (newPathFor(t) !== null || !pageExists(t)))
      .map((t) => rel(f) + ': ' + t))
    expect(bad).toEqual([])
  })

  it('komponen halaman lama yang dipasang di aplikasi baru: setiap tautan internal menuju halaman yang ada atau punya padanan', () => {
    const entries = [
      join(ROOT, 'src/components/inbox/InboxScreen.tsx'),
      ...walk(join(ROOT, 'src/components/legacy-pages')),
      ...['settings', 'templates', 'bot-control', 'ai-office'].flatMap((d) => walk(join(APP, d))),
    ]
    const seen = new Set<string>()
    const queue = [...entries]
    while (queue.length) {
      const f = queue.pop()!
      if (seen.has(f)) continue
      seen.add(f)
      for (const m of readFileSync(f, 'utf8').matchAll(/from '(@\/components\/[^']+|\.{1,2}\/[^']+)'/g)) {
        const base = m[1].startsWith('@/') ? join(ROOT, 'src', m[1].slice(2)) : join(dirname(f), m[1])
        const hit = [base + '.tsx', base + '.ts', join(base, 'index.tsx'), join(base, 'index.ts')].find((p) => existsSync(p))
        if (hit && !hit.includes('/components/new/')) queue.push(hit)
      }
    }
    expect(seen.size).toBeGreaterThan(40)
    const broken = [...seen].flatMap((f) => navTargets(readFileSync(f, 'utf8'))
      .filter((t) => !t.startsWith('/api/') && newPathFor(t) === null && !pageExists(t))
      .map((t) => rel(f) + ': ' + t))
    expect(broken).toEqual([])
  })
})
