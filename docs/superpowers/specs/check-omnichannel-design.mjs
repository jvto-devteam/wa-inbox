#!/usr/bin/env node
/**
 * Pemeriksa mekanis untuk 2026-09-23-omnichannel-inbox-design.md.
 *
 * Dokumen desain itu mengklaim hal-hal tentang keadaan repo SEKARANG: file mana yang ada,
 * simbol mana yang sudah terbangun, dan -- sama pentingnya -- apa yang BELUM ada. Klaim
 * "belum ada" adalah yang paling cepat basi, karena ia diam-diam menjadi salah begitu
 * seseorang mulai mengerjakan fasenya.
 *
 * Keluar dengan kode != 0 berarti DOKUMENNYA yang usang, bukan reponya yang salah.
 *
 * Jalankan: node docs/superpowers/specs/check-omnichannel-design.mjs
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const failures = []
const checks = []

function read(rel) {
  const p = join(ROOT, rel)
  return existsSync(p) ? readFileSync(p, 'utf8') : null
}

/** File harus ada. */
function fileExists(rel) {
  checks.push(rel)
  if (!existsSync(join(ROOT, rel))) failures.push(`file hilang: ${rel}`)
}

/** File harus MEMUAT pola ini (klaim "sudah ada"). */
function mustContain(rel, pattern, why) {
  checks.push(`${rel} :: ${why}`)
  const src = read(rel)
  if (src === null) return failures.push(`file hilang: ${rel} (butuh: ${why})`)
  const re = pattern instanceof RegExp ? pattern : new RegExp(pattern)
  if (!re.test(src)) failures.push(`${rel}: tidak lagi memuat ${why} — pola ${re}`)
}

/** File TIDAK BOLEH memuat pola ini (klaim "belum ada"). */
function mustNotContain(rel, pattern, why) {
  checks.push(`${rel} :: TIDAK ada ${why}`)
  const src = read(rel)
  if (src === null) return failures.push(`file hilang: ${rel} (butuh: TIDAK ada ${why})`)
  const re = pattern instanceof RegExp ? pattern : new RegExp(pattern)
  if (re.test(src)) failures.push(`${rel}: sekarang SUDAH memuat ${why} — desain perlu diperbarui`)
}

// ---------------------------------------------------------------------------
// §3 — yang diklaim SUDAH ada dan dipakai ulang
// ---------------------------------------------------------------------------
for (const f of [
  'prisma/schema.prisma',
  'src/lib/inbox/message-draft.ts',
  'src/components/inbox/MessageDraftCard.tsx',
  'src/components/inbox/MessageBubble.tsx',
  'src/lib/meta/webhook-verify.ts',
  'src/app/api/webhooks/meta/route.ts',
  'src/lib/inbound.ts',
  'src/app/api/bot/mode/route.ts',
  'src/lib/send.ts',
  'src/lib/outbound/worker.ts',
  'src/lib/phone.ts',
  'src/lib/channel-router.ts',
  'src/lib/bot-control/channel-capabilities.ts',
  'src/components/inbox/ConversationListItem.tsx',
]) fileExists(f)

// §3.1 alur draf manual sudah lengkap
for (const fn of ['generateDraft', 'editDraft', 'reviseDraftWithPrompt', 'sendDraft', 'draftsForConversation'])
  mustContain('src/lib/inbox/message-draft.ts', new RegExp(`export async function ${fn}\\b`), `fungsi ${fn}()`)
mustContain('src/lib/inbox/message-draft.ts', /tidak pernah otomatis/, 'janji "tidak pernah otomatis" di kepala file')
mustContain('prisma/schema.prisma', /^model MessageDraft /m, 'model MessageDraft')
mustContain('src/components/inbox/MessageBubble.tsx', /generateDraft/, 'tombol generate draf')

// §3.2 idempotensi
mustContain('prisma/schema.prisma', /externalId\s+String\?\s+@unique/, 'Message.externalId @unique')

// §3.3 verifikasi webhook generik
mustContain('src/lib/meta/webhook-verify.ts', /timingSafeEqual/, 'timingSafeEqual')
mustContain('src/app/api/webhooks/meta/route.ts', /verifyMetaSignature/, 'pemakaian verifyMetaSignature')

// §3.4 pola kredensial per-akun
mustContain('prisma/schema.prisma', /^model WaNumber /m, 'model WaNumber sebagai contoh pola')

// ---------------------------------------------------------------------------
// §4 — tiga kunci yang akan dilepas, dan enum yang TIDAK disentuh
// ---------------------------------------------------------------------------
mustContain('prisma/schema.prisma', /phone\s+String\s+@unique/, 'Contact.phone @unique (yang akan dilepas)')
mustContain('prisma/schema.prisma', /contactId\s+String\s+@unique/, 'Conversation.contactId @unique (yang akan dilepas)')

// MessageChannel harus tetap PERSIS dua nilai; desain bergantung pada ini.
const schema = read('prisma/schema.prisma') ?? ''
const mc = schema.match(/enum MessageChannel \{([^}]*)\}/)
checks.push('enum MessageChannel tepat [OFFICIAL, UNOFFICIAL]')
if (!mc) failures.push('prisma/schema.prisma: enum MessageChannel tidak ditemukan')
else {
  const values = mc[1].split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('//'))
  if (values.join(',') !== 'OFFICIAL,UNOFFICIAL')
    failures.push(`enum MessageChannel sekarang [${values.join(', ')}] — desain mengasumsikan tepat OFFICIAL+UNOFFICIAL`)
}

// §4 klaim "belum ada"
mustNotContain('prisma/schema.prisma', /^enum Platform /m, 'enum Platform')
mustNotContain('prisma/schema.prisma', /^model ChannelIdentity /m, 'model ChannelIdentity')
mustNotContain('prisma/schema.prisma', /^model MailAccount /m, 'model MailAccount')

// ---------------------------------------------------------------------------
// §5 — gerbang bot: satu, bukan dua
// ---------------------------------------------------------------------------
mustContain('src/lib/inbound.ts', /export async function defaultBotEnabled\(/, 'defaultBotEnabled()')
mustContain('src/lib/inbound.ts', /conversation\.botEnabled && botCanAnswer/, 'gerbang runtime tunggal conversation.botEnabled')
mustContain('src/app/api/bot/mode/route.ts', /updateMany/, 'botAutoReplyAll sebagai penulis massal, bukan gerbang')
mustContain('src/lib/phone.ts', /isIndonesianNumber/, 'isIndonesianNumber()')
mustContain('src/lib/phone.ts', /\^62/, 'regex prefix 62 yang tidak akan cocok dengan IGSID/PSID')
// defaultBotEnabled belum sadar platform -- begitu ia sadar, fase 2 sudah jalan.
mustNotContain('src/lib/inbound.ts', /defaultBotEnabled\([^)]*platform/i, 'parameter platform di defaultBotEnabled')

// ---------------------------------------------------------------------------
// §6 — parser masuk belum mengenal IG/FB
// ---------------------------------------------------------------------------
mustNotContain('src/lib/inbound.ts', /payload\.object|\bentry\[\d*\]?\.messaging\b|value\.messaging/, 'percabangan payload.object / entry[].messaging[]')

// §6.3 — belum ada infrastruktur email sama sekali
for (const rel of ['src/lib/inbound.ts', 'src/lib/send.ts', 'prisma/schema.prisma'])
  mustNotContain(rel, /gmail|imap|smtp|nodemailer/i, 'jejak email')

// ---------------------------------------------------------------------------
// §7 — dispatch keluar masih WhatsApp-saja
// ---------------------------------------------------------------------------
mustContain('src/lib/send.ts', /channel === 'OFFICIAL'/, "percabangan if (channel === 'OFFICIAL')")
mustContain('src/lib/channel-router.ts', /export async function resolveChannelForCapability\(/, 'resolveChannelForCapability()')
mustContain('src/lib/bot-control/channel-capabilities.ts', /OutboundChannel\s*=/, 'tipe OutboundChannel')

// ---------------------------------------------------------------------------
// §8 — orderChannel adalah asal BOOKING, bukan channel pesan
// ---------------------------------------------------------------------------
mustContain('prisma/schema.prisma', /orderChannel/, 'Conversation.orderChannel')
mustContain('src/components/inbox/ConversationListItem.tsx', /orderChannel/, 'badge orderChannel di sidebar')

// ---------------------------------------------------------------------------
console.log(`omnichannel-design: ${checks.length} klaim diperiksa`)
if (failures.length) {
  console.error(`\n✗ ${failures.length} klaim tidak lagi cocok dengan repo:\n`)
  for (const f of failures) console.error(`  - ${f}`)
  console.error('\nDokumen desainnya yang usang. Perbarui sebelum dipakai.\n')
  process.exit(1)
}
console.log('✓ semua klaim di 2026-09-23-omnichannel-inbox-design.md masih cocok dengan repo')
