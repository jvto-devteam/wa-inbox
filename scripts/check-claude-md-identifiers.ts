/**
 * Pemeriksa mekanis CLAUDE.md §9 untuk subbagian "Aksi booking (chat → booking)".
 * Mengambil setiap `kode` di antara penanda <!-- aksi-booking:mulai --> dan <!-- aksi-booking:selesai -->
 * lalu memastikan: path file ada, simbol muncul di src/ atau prisma/schema.prisma, env ada di src/.
 * Keluar dengan kode 1 bila ada yang tidak ditemukan. Jalankan: npx tsx scripts/check-claude-md-identifiers.ts
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const doc = readFileSync(join(root, 'CLAUDE.md'), 'utf8')
const start = doc.indexOf('<!-- aksi-booking:mulai -->')
const end = doc.indexOf('<!-- aksi-booking:selesai -->')
if (start < 0 || end < start) {
  console.error('Penanda subbagian Aksi booking tidak ditemukan di CLAUDE.md')
  process.exit(1)
}
const section = doc.slice(start, end)

function walk(dir: string, out: string[]): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full)
  }
  return out
}
const corpus =
  walk(join(root, 'src'), []).map((f) => readFileSync(f, 'utf8')).join('\n') +
  '\n' +
  readFileSync(join(root, 'prisma/schema.prisma'), 'utf8')

const tokens = new Set<string>()
for (const m of section.matchAll(/`([^`]+)`/g)) tokens.add(m[1])

// Field respons backoffice yang SENGAJA tidak pernah dirujuk kode kita (dinyatakan di dokumen sebagai tidak dikirim ke LLM).
const NEVER_REFERENCED = new Set(['paymentHistory'])

const failures: string[] = []
let checked = 0
for (const raw of tokens) {
  const t = raw.trim()
  // path file di repo
  if (/^(src|scripts|prisma)\/[\w./\[\]-]+\.\w+$/.test(t)) {
    checked++
    if (!existsSync(join(root, t))) failures.push(`path tidak ada: ${t}`)
    continue
  }
  // route API: cek folder src/app<route>
  const route = t.match(/^(?:GET|POST|PATCH) (\/api\/[\w/\[\]-]+)$/)
  if (route) {
    checked++
    if (!existsSync(join(root, 'src/app', route[1]))) failures.push(`route tidak ada: ${t}`)
    continue
  }
  // identifier / env / nama tabel
  const id = t.match(/^([A-Za-z_][A-Za-z0-9_]*)(?:\(\))?$/)
  if (id) {
    // kata biasa dan nilai literal (bukan simbol kode) dilewati bila huruf kecil tanpa camelCase
    const isSymbol = /[A-Z]/.test(id[1]) && !/^[A-Z]+$/.test(id[1]) || /_/.test(id[1]) || /\(\)$/.test(t)
    if (!isSymbol) continue
    // nilai enum seperti OPEN/EXECUTING/ALWAYS dilewati; konstanta dengan underscore dicek
    if (/^[A-Z]+$/.test(id[1])) continue
    if (NEVER_REFERENCED.has(id[1])) continue
    checked++
    if (!new RegExp(`\\b${id[1]}\\b`).test(corpus)) failures.push(`simbol tidak ditemukan: ${t}`)
  }
}

if (failures.length > 0) {
  console.error(failures.join('\n'))
  console.error(`GAGAL: ${failures.length} dari ${checked} acuan tidak ditemukan`)
  process.exit(1)
}
console.log(`OK: ${checked} acuan di subbagian Aksi booking ditemukan`)
