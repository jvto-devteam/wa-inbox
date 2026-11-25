import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { newPathFor } from './legacy-routes'

// Pemeriksa mekanis permintaan owner 2026-11-26: "tidak ada link mengarah ke page lama, tapi ke page di dalam /new".
const ROOT = join(__dirname, '..', '..', '..')
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
  return [...code.matchAll(re)].map((m) => m[1])
}

describe('tautan /new', () => {
  it('peta halaman lama -> /new', () => {
    expect(newPathFor('/inbox')).toBe('/new/inbox')
    expect(newPathFor('/contacts/abc')).toBe('/new/kontak/abc')
    expect(newPathFor('/summary')).toBe('/new/antrean')
    expect(newPathFor('/chatbot')).toBe('/new/bot/pengaturan')
    expect(newPathFor('/bot-control/knowledge')).toBe('/new/bot/knowledge')
    expect(newPathFor('/settings/knowledge-gaps')).toBe('/new/bot/celah')
    expect(newPathFor('/bot-control/decisions')).toBe('/new/bot/keputusan')
    expect(newPathFor('/new/inbox')).toBeNull()
    // setiap tujuan peta benar-benar ada sebagai halaman /new
    for (const p of ['/inbox', '/contacts/x', '/contacts', '/summary', '/dashboard', '/chatbot', '/bot-control/knowledge', '/settings/knowledge-gaps', '/bot-control/decisions']) {
      const to = newPathFor(p)!.replace('/new/kontak/x', '/new/kontak/[id]')
      expect(existsSync(join(ROOT, 'src', 'app', to, 'page.tsx')), to).toBe(true)
    }
  })

  it('kode /new sendiri tidak menulis alamat halaman lama', () => {
    const files = [...walk(join(ROOT, 'src', 'components', 'new')), ...walk(join(ROOT, 'src', 'lib', 'new')), ...walk(join(ROOT, 'src', 'app', 'new'))]
    const bad = files.flatMap((f) => navTargets(readFileSync(f, 'utf8')).filter((t) => !t.startsWith('/new') && !t.startsWith('/api/')).map((t) => rel(f) + ': ' + t))
    expect(bad).toEqual([])
  })

  it('komponen lama yang dipasang di /new: setiap tautan ke halaman internal punya padanan /new', () => {
    const entries = [
      'src/components/inbox/InboxScreen.tsx',
      'src/app/(authenticated)/chatbot/page.tsx',
      'src/app/(authenticated)/bot-control/knowledge/page.tsx',
      'src/app/(authenticated)/settings/knowledge-gaps/page.tsx',
      'src/app/(authenticated)/bot-control/decisions/page.tsx',
      'src/app/(authenticated)/contacts/[id]/page.tsx',
    ].map((p) => join(ROOT, p))
    // telusuri impor '@/components/...' dan relatif dari halaman-halaman itu
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
    expect(seen.size).toBeGreaterThan(20)
    const unmapped = [...seen].flatMap((f) => navTargets(readFileSync(f, 'utf8'))
      .filter((t) => !t.startsWith('/api/') && !t.startsWith('/new') && newPathFor(t.replace(/\/$/, '')) === null)
      .map((t) => rel(f) + ': ' + t))
    expect(unmapped).toEqual([])
  })
})
