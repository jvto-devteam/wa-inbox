#!/usr/bin/env node
/**
 * Pemeriksa mekanis untuk RANCANGAN.md (CLAUDE.md §9): setiap angka dan nama simbol yang dikutip
 * dokumen dihitung ulang dari sumbernya. Keluar dengan kode 1 bila satu klaim pun tidak cocok.
 *
 * Dua arah:
 *   1. Nilai di sumber (kode / docs/replay) == nilai yang diharapkan.
 *   2. Teks dokumen memuat nilai itu persis seperti ditulis.
 * Ditambah: setiap identifier ber-backtick di dokumen harus ada di src/prisma/scripts atau sebagai
 * kunci data di docs/replay, atau terdaftar di
 * bagian "Nama baru rancangan".
 *
 * Jalankan dari root repo: node docs/knowledge-learning/check-rancangan.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const ROOT = process.cwd()
const DOC_PATH = 'docs/knowledge-learning/RANCANGAN.md'
const doc = read(DOC_PATH)
const failures = []
let passed = 0

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8')
}
function json(rel) {
  return JSON.parse(read(rel))
}
function check(label, ok, detail = '') {
  if (ok) passed += 1
  else failures.push(`${label}${detail ? ` — ${detail}` : ''}`)
}
function equal(label, actual, expected) {
  check(label, actual === expected, `sumber=${JSON.stringify(actual)} diharapkan=${JSON.stringify(expected)}`)
}
function docHas(label, text) {
  check(`dokumen memuat ${label}`, doc.includes(text), `teks "${text}" tidak ditemukan`)
}
function constant(rel, name) {
  const m = read(rel).match(new RegExp(`export const ${name}\\s*=\\s*([^\\n]+)`))
  if (!m) return undefined
  // Hanya ekspresi angka sederhana (mis. 60 * 60 * 1000).
  const expr = m[1].trim()
  return /^[\d\s*+]+$/.test(expr) ? Function(`return (${expr})`)() : expr
}

// ---------------------------------------------------------------------------------------------
// 1. Kode
// ---------------------------------------------------------------------------------------------
equal('MAX_MANAGED_ITEMS_PER_TURN', constant('src/lib/bot/runtime-integration.ts', 'MAX_MANAGED_ITEMS_PER_TURN'), 8)
docHas('plafon 8', '`MAX_MANAGED_ITEMS_PER_TURN` = 8')

equal('BURST_DEBOUNCE_MS', constant('src/lib/inbound.ts', 'BURST_DEBOUNCE_MS'), 5000)
equal('BURST_MAX_WAIT_MS', constant('src/lib/inbound.ts', 'BURST_MAX_WAIT_MS'), 25000)
equal('BROADCAST_MIN_CONVERSATIONS', constant('src/lib/bot/eval/replay-pairs.ts', 'BROADCAST_MIN_CONVERSATIONS'), 3)
docHas('ambang broadcast 3', 'teks sama di ≥ 3 percakapan')

const replayPairs = read('src/lib/bot/eval/replay-pairs.ts')
check('replay-pairs hanya pesan pembuka', replayPairs.includes('Hanya pesan PEMBUKA'))

const resolverSrc = read('src/lib/bot/module-resolver.ts')
const topicsBlock = resolverSrc.match(/export const RESOLVER_TOPICS = \[([\s\S]*?)\] as const/)
const topics = topicsBlock ? [...topicsBlock[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]) : []
equal('jumlah RESOLVER_TOPICS', topics.length, 14)
docHas('14 topik', '`RESOLVER_TOPICS` berisi 14 topik')

const bodySrc = read('src/lib/bot-control/knowledge-body.ts')
const itemBlock = bodySrc.match(/export const knowledgeItemSchema = z\s*\.object\(\{([\s\S]*?)\n  \}\)\s*\.strict\(\)/)
const itemKeys = itemBlock ? [...itemBlock[1].matchAll(/^\s{4}(\w+):/gm)].map((m) => m[1]) : []
equal('field knowledgeItemSchema', itemKeys.join(','), 'question,answer,tags,topics,links,prices')
docHas('daftar field', 'question, answer, tags, topics, links, prices')

const catalogSrc = read('src/lib/bot/catalog.ts')
const buildBlock = catalogSrc.match(/function buildCatalog\(\): Catalog \{([\s\S]*?)const packages/)
const catalogReads = buildBlock ? (buildBlock[1].match(/readCatalogFile\(/g) ?? []).length : 0
equal('file dibaca buildCatalog', catalogReads, 10)
check('buildCatalog tidak membaca META_FILE', buildBlock !== null && !buildBlock[1].includes('META_FILE'))
docHas('10 file buildCatalog', '`buildCatalog` membaca 10 file')

const schema = read('prisma/schema.prisma')
const sentBy = schema.match(/enum SentBy \{([\s\S]*?)\}/)
equal('enum SentBy', sentBy ? sentBy[1].trim().split(/\s+/).join(',') : null, 'BOT,AGENT,CUSTOMER')
const draftModel = schema.match(/model MessageDraft \{([\s\S]*?)\n\}/)
for (const field of ['generatedText', 'text', 'sentMessageId']) {
  check(`MessageDraft.${field} ada`, draftModel !== null && new RegExp(`\\n\\s+${field}\\s`).test(draftModel[1]))
}
const gapModel = schema.match(/model KnowledgeGapLog \{([\s\S]*?)\n\}/)
for (const field of ['topic', 'reason', 'resolvedAt']) {
  check(`KnowledgeGapLog.${field} ada`, gapModel !== null && new RegExp(`\\n\\s+${field}\\s`).test(gapModel[1]))
}

const draftSrc = read('src/lib/inbox/message-draft.ts')
check('sendDraft mengirim draft.text yang di-trim', draftSrc.includes("const text = (draft.text ?? '').trim()"))

const gapLogSrc = read('src/lib/inbox/gap-log.ts')
check('gap log hanya mode faq', gapLogSrc.includes("decision.mode !== 'faq'"))

const callers = execFileSync('grep', ['-rlw', 'recordUnsourcedReplyGap', 'src'], { encoding: 'utf8' })
  .trim()
  .split('\n')
  .filter((f) => !f.includes('.test.') && f !== 'src/lib/inbox/gap-log.ts')
  .sort()
equal('pemanggil recordUnsourcedReplyGap', callers.join(','), 'src/lib/inbound.ts,src/lib/inbox/message-draft.ts')

check('evaluateScenario membaca itinerary-intelligence', read('src/lib/bot/scenario-evaluator.ts').includes('itinerary-intelligence/'))

const workflowSrc = read('src/lib/bot-control/knowledge-workflow.ts')
for (const fn of ['saveKnowledgeDraft', 'publishKnowledgeRevision']) {
  check(`${fn} diekspor`, workflowSrc.includes(`export async function ${fn}(`))
}

// ---------------------------------------------------------------------------------------------
// 2. docs/replay
// ---------------------------------------------------------------------------------------------
const admin = json('docs/replay/knowledge-percakapan-admin-2026-09-15.json')
const r = admin.ringkasan
const s = r.buktiSetelahSaringan
const numbers = [
  ['percakapan dibaca', r.percakapanDibaca, 371, '| 371 |'],
  ['fakta diekstrak', r.faktaDiekstrak, 1686, '1.686 / 1.660'],
  ['fakta dinilai', r.faktaDinilai, 1660, '1.686 / 1.660'],
  ['fakta dihitung', s.faktaDihitung, 1537, '1.537 (92,6%)'],
  ['fakta didemosikan', s.faktaDidemosikan, 30, '| 30 / 80 |'],
  ['fakta dibuang', s.faktaDibuang, 80, '| 30 / 80 |'],
  ['topik', r.topik, 327, '| 327 / 229 |'],
  ['topik array', admin.topik.length, 327, '| 327 / 229 |'],
  ['layak', r.layakDitambahkan, 229, '| 327 / 229 |'],
  ['layak (hitung topik)', admin.topik.filter((t) => t.layakDitambahkan === true).length, 229, '| 327 / 229 |'],
  ['cukup bukti', s.topikPerStatusAmbang['cukup bukti'], 214, '| 214 |'],
  ['sudah diketahui bot', r.alasanBelumLayak['Bot sudah tahu'], 52, '| 52 / 30 / 16 |'],
  ['ditahan operator', r.alasanBelumLayak['Ditahan operator'], 30, '| 52 / 30 / 16 |'],
  ['sementara', r.alasanBelumLayak['Kondisi sementara (di luar lingkup)'], 16, '| 52 / 30 / 16 |'],
]
for (const [label, actual, expected, text] of numbers) {
  equal(label, actual, expected)
  docHas(label, text)
}
equal('persen dihitung', ((s.faktaDihitung / r.faktaDinilai) * 100).toFixed(1), '92.6')

const dates = admin.topik.flatMap((t) => (t.rujukanFakta ?? []).map((f) => f.tanggal)).filter(Boolean).sort()
const first = dates[0]
const last = dates[dates.length - 1]
const days = Math.round((new Date(last) - new Date(first)) / 864e5) + 1
equal('tanggal fakta pertama', first, '2026-07-27')
equal('tanggal fakta terakhir', last, '2026-09-15')
equal('rentang hari', days, 51)
docHas('rentang', '2026-07-27 s.d. 2026-09-15 (51 hari)')
// Ralat 2026-09-17: 371/51 bukan "percakapan per hari" dalam arti apa pun yang dipakai pipeline.
check('dokumen tidak lagi memuat angka 7,3 per hari', !doc.includes('7,3'))

const decisions = Object.entries(json('docs/replay/keputusan-operator-2026-09-16.json')).filter(([k]) => !k.startsWith('_'))
const byDecision = decisions.reduce((acc, [, v]) => ({ ...acc, [v.keputusan]: (acc[v.keputusan] ?? 0) + 1 }), {})
equal('keputusan total', decisions.length, 149)
equal('keputusan lolos', byDecision.lolos, 119)
equal('keputusan tahan', byDecision.tahan, 30)
docHas('keputusan', '| 149 (119 / 30) |')

const baru = json('docs/replay/knowledge-baru-2026-09-16.json')
equal('usulan baru', baru.baru.length, 113)
equal('usulan melengkapi', baru.melengkapi.length, 77)
equal('usulan koreksi', baru.koreksi.length, 32)
equal('usulan sementara', baru.sementara.length, 7)
equal('usulan total', baru.baru.length + baru.melengkapi.length + baru.koreksi.length + baru.sementara.length, 229)
docHas('usulan', '| 113 / 77 / 32 / 7 |')

const fixes = json('docs/replay/perbaikan-knowledge-published-2026-09-16.json')
equal('naskah perbaikan', fixes.perbaikan.map((f) => f.sumber).join(','), 'BLUE FIRE,BEST TIME,GENERAL,PAYMENT')
equal('perlu ditinjau', fixes.perluDitinjauOperator.map((f) => f.sumber).join(','), 'DESTINATIONS')
check('naskah perbaikan belum diterapkan', fixes._catatan.includes('BELUM diterapkan'))
docHas('perbaikan', '| 4 (+1 perlu ditinjau) |')
docHas('nama perbaikan', 'BLUE FIRE, BEST TIME, GENERAL, PAYMENT')
check('berkas pemisahan sementara ada', fs.existsSync('docs/replay/pemisahan-sementara-2026-09-17.json'))

// ---------------------------------------------------------------------------------------------
// 2b. Produksi (baca-saja)
//
// Setiap kueri dibatasi CUTOFF supaya hasilnya sama besok dan lusa; tanpa batas itu pemeriksa akan
// merah setiap hari karena data bertambah, dan pemeriksa yang selalu merah akhirnya diabaikan.
// Dijalankan di dalam BEGIN TRANSACTION READ ONLY ... ROLLBACK. Kredensial dibaca dari .env dan
// tidak pernah dicetak. Melewati bagian ini hanya lewat flag eksplisit --lewati-produksi.
// ---------------------------------------------------------------------------------------------
const CUTOFF = '2026-09-17T00:00:00+07:00'
const PROD_QUERIES = {
  percakapan_nontest: `SELECT count(*) FROM "Conversation" WHERE NOT "isTest" AND "createdAt" < '${CUTOFF}'`,
  percakapan_baru_per_minggu: `SELECT string_agg(n::text, ',' ORDER BY w) FROM (
      SELECT date_trunc('week', f AT TIME ZONE 'Asia/Jakarta') w, count(*) n FROM (
        SELECT m."conversationId", min(m."createdAt") f FROM "Message" m JOIN "Conversation" c ON c.id = m."conversationId"
        WHERE NOT c."isTest" GROUP BY 1) x
      WHERE f < '2026-09-14T00:00:00+07:00' GROUP BY 1) y`,
  aktif_per_hari: `SELECT round(avg(n), 1) || '|' || percentile_cont(0.5) WITHIN GROUP (ORDER BY n) || '|' || min(n) || '|' || max(n) FROM (
      SELECT (m."createdAt" AT TIME ZONE 'Asia/Jakarta')::date, count(DISTINCT m."conversationId") n
      FROM "Message" m JOIN "Conversation" c ON c.id = m."conversationId"
      WHERE NOT c."isTest" AND m."sentBy" IN ('AGENT', 'CUSTOMER')
        AND m."createdAt" >= '2026-08-01T00:00:00+07:00' AND m."createdAt" < '${CUTOFF}' GROUP BY 1) d`,
  pesan_bot_sejak_0810: `SELECT count(*) FROM "Message" WHERE "sentBy" = 'BOT' AND "createdAt" >= '2026-08-10T00:00:00+07:00' AND "createdAt" < '${CUTOFF}'`,
  draft: `SELECT count(*) || '|' || count(*) FILTER (WHERE "sentMessageId" IS NOT NULL) || '|' ||
      count(*) FILTER (WHERE "sentMessageId" IS NOT NULL AND coalesce(trim("generatedText"), '') <> coalesce(trim("text"), ''))
      FROM "MessageDraft" WHERE "createdAt" < '${CUTOFF}'`,
  gap: `SELECT count(*) || '|' || count(DISTINCT "conversationId") || '|' || count(DISTINCT topic) FROM "KnowledgeGapLog" WHERE "createdAt" < '${CUTOFF}'`,
  gap_reason: `SELECT string_agg(reason || '=' || n, ',' ORDER BY reason) FROM (
      SELECT reason, count(*) n FROM "KnowledgeGapLog" WHERE "createdAt" < '${CUTOFF}' GROUP BY 1) g`,
  versi_terbit: `SELECT string_agg(title || '=' || v, ',' ORDER BY title) FROM (
      SELECT s.title, max(r.version) v FROM "KnowledgeSource" s JOIN "KnowledgeRevision" r ON r."knowledgeSourceId" = s.id
      WHERE r."publishedAt" < '${CUTOFF}' AND s.title IN ('BLUE FIRE', 'BEST TIME', 'GENERAL', 'PAYMENT', 'DESTINATIONS')
      GROUP BY 1) t`,
}

function runProductionQueries() {
  const envLine = read('.env').split('\n').find((l) => l.startsWith('DATABASE_URL='))
  if (!envLine) throw new Error('DATABASE_URL tidak ada di .env')
  const url = envLine.slice('DATABASE_URL='.length).trim().replace(/^"|"$/g, '').replace(/\?.*$/, '')
  const keys = Object.keys(PROD_QUERIES)
  const sql = [
    'BEGIN TRANSACTION READ ONLY;',
    ...keys.map((k) => `SELECT '${k}', (${PROD_QUERIES[k]});`),
    'ROLLBACK;',
  ].join('\n')
  const out = execFileSync('psql', [url, '-X', '-q', '-A', '-t', '-F', '\t', '-v', 'ON_ERROR_STOP=1'], {
    input: sql,
    encoding: 'utf8',
    env: { ...process.env, PGCONNECT_TIMEOUT: '15' },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  return Object.fromEntries(
    out
      .split('\n')
      .map((l) => l.split('\t'))
      .filter((p) => p.length === 2 && keys.includes(p[0]))
  )
}

if (process.argv.includes('--lewati-produksi')) {
  console.warn('PERINGATAN: cek produksi DILEWATI (--lewati-produksi). Angka produksi di dokumen tidak diverifikasi.')
} else {
  let prod = null
  try {
    prod = runProductionQueries()
  } catch (error) {
    // Pesan psql bisa memuat URL koneksi; jangan cetak mentah.
    const message = String(error?.stderr ?? error?.message ?? error).replace(/postgres(ql)?:\/\/\S+/g, '<redacted>')
    check('kueri produksi berjalan', false, message.split('\n')[0])
  }
  if (prod) {
    const prodClaims = [
      ['percakapan non-test', prod.percakapan_nontest, '375', '| Percakapan non-test | 375 |'],
      ['percakapan baru per minggu', prod.percakapan_baru_per_minggu, '118,67,40,33,34,43,35', '| 118, 67, 40, 33, 34, 43, 35 |'],
      ['percakapan aktif per hari', prod.aktif_per_hari, '31.8|29|15|68', 'rata-rata 31,8, median 29, rentang 15–68'],
      ['pesan BOT sejak 2026-08-10', prod.pesan_bot_sejak_0810, '0', '| Pesan `BOT` sejak 2026-08-10 | 0 |'],
      ['draft', prod.draft, '10|4|4', '| 10 / 4 / 4 |'],
      ['gap log', prod.gap, '38|3|7', '| 38 / 3 / 7 |'],
      ['reason gap log', prod.gap_reason, 'reply_deferred_knowledge=30,reply_unsourced=8', '`reply_deferred_knowledge` (30), `reply_unsourced` (8)'],
      ['versi terbit', prod.versi_terbit, 'BEST TIME=1,BLUE FIRE=1,DESTINATIONS=1,GENERAL=1,PAYMENT=1', '| v1 semuanya |'],
    ]
    for (const [label, actual, expected, text] of prodClaims) {
      equal(`produksi: ${label}`, actual, expected)
      docHas(`produksi: ${label}`, text)
    }
    docHas('batas waktu produksi', 'batas waktu 2026-09-17 00:00 WIB')
  }
}

// ---------------------------------------------------------------------------------------------
// 3. Identifier ber-backtick
// ---------------------------------------------------------------------------------------------
const newNamesSection = doc.split('## 9. Nama baru rancangan')[1]?.split('\n## ')[0] ?? ''
const newNames = new Set([...newNamesSection.matchAll(/`([^`]+)`/g)].map((m) => m[1]))
check('daftar nama baru tidak kosong', newNames.size > 0)

const tokens = new Set([...doc.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]))
for (const token of tokens) {
  if (newNames.has(token)) continue
  const isPath = token.includes('/') || /\.(ts|json|mjs|md|prisma)$/.test(token)
  if (isPath) {
    if (token.startsWith('node ')) continue
    check(`path ada: ${token}`, fs.existsSync(path.join(ROOT, token)))
    continue
  }
  // Ekspresi (mis. "`MAX_MANAGED_ITEMS_PER_TURN` = 8") dibaca sebagai identifier di kirinya saja.
  const ids = token.split(/[\s=≠+,]+/).filter((x) => /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$/.test(x))
  for (const id of ids) {
    if (newNames.has(id)) continue
    for (const part of id.split('.')) {
      let found = false
      try {
        execFileSync('grep', ['-rqw', '--', part, 'src', 'prisma', 'scripts', 'docs/replay'])
        found = true
      } catch {
        found = false
      }
      check(`identifier ada di repo: ${part}`, found)
    }
  }
}

// ---------------------------------------------------------------------------------------------
console.log(`${passed} lolos, ${failures.length} gagal`)
if (failures.length > 0) {
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
