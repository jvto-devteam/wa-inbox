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
// Fase fondasi SELESAI 2026-09-24: kedua kunci ini sudah dilepas di produksi.
// Assertion-nya berbalik arah — dulu "harus ada (akan dilepas)", kini "harus SUDAH lepas".
mustContain('prisma/schema.prisma', /phone\s+String\?/, 'Contact.phone sudah nullable')
mustNotContain('prisma/schema.prisma', /phone\s+String\s+@unique/, 'Contact.phone @unique (sudah dilepas)')
// Terikat ke model Conversation, bukan seluruh file: ContactConsent.contactId MEMANG
// @unique (satu baris consent per kontak) dan tidak ada hubungannya dengan migrasi ini.
// Versi pertama pemeriksa ini salah membacanya sebagai constraint yang gagal dilepas.
checks.push('Conversation.contactId sudah TIDAK unik')
const convModel = ((read('prisma/schema.prisma') ?? '').match(/model Conversation \{[\s\S]*?\n\}/) ?? [''])[0]
if (!convModel) failures.push('prisma/schema.prisma: model Conversation tidak ditemukan')
else if (/contactId\s+String\s+@unique/.test(convModel))
  failures.push('prisma/schema.prisma: Conversation.contactId masih @unique — migrasi pelonggaran belum jalan')
mustContain('prisma/schema.prisma', /@@unique\(\[channelIdentityId, externalThreadId\]\)/, 'kunci benang gabungan')

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

// §4 — fondasi SUDAH dibangun (2026-09-24); MailAccount masih menunggu fase email.
mustContain('prisma/schema.prisma', /^enum Platform /m, 'enum Platform')
mustContain('prisma/schema.prisma', /^model ChannelIdentity /m, 'model ChannelIdentity')
mustNotContain('prisma/schema.prisma', /^model MailAccount /m, 'model MailAccount (fase email, belum)')

// ---------------------------------------------------------------------------
// §5 — gerbang bot: satu, bukan dua
// ---------------------------------------------------------------------------
mustContain('src/lib/inbound.ts', /export async function defaultBotEnabled\(/, 'defaultBotEnabled()')
mustContain('src/lib/inbound.ts', /conversation\.botEnabled && botCanAnswer/, 'gerbang runtime tunggal conversation.botEnabled')
mustContain('src/app/api/bot/mode/route.ts', /updateMany/, 'botAutoReplyAll sebagai penulis massal, bukan gerbang')
mustContain('src/lib/phone.ts', /isIndonesianNumber/, 'isIndonesianNumber()')
mustContain('src/lib/phone.ts', /\^62/, 'regex prefix 62 yang tidak akan cocok dengan IGSID/PSID')
// Fase sakelar per-channel SELESAI: defaultBotEnabled kini sadar platform.
mustContain('src/lib/inbound.ts', /defaultBotEnabled\(input: \{ platform: Platform/, 'defaultBotEnabled sadar platform')
// C-1: sakelar global HARUS tetap ikut dibaca. Regresi ini pernah terjadi dan lolos ke
// produksi -- sakelar darurat "Matikan (Off)" berhenti berlaku untuk percakapan baru.
mustContain('src/lib/inbound.ts', /settings\.botAutoReplyAll && settings\[TOGGLE_BY_PLATFORM/, 'sakelar global DAN sakelar platform, keduanya dibaca')
mustContain('src/lib/channel/platform.ts', /hasPhoneNumber/, 'penjaga hasPhoneNumber')

// ---------------------------------------------------------------------------
// §6 — parser masuk SUDAH mengenal IG dan FB (selesai di fase Facebook, 2026-09-25)
// ---------------------------------------------------------------------------
// Assertion-nya berbalik arah, seperti §4 saat fase fondasi selesai. Dulu "belum ada
// percabangan payload.object"; kini percabangan itu WAJIB ada untuk KEDUA platform.
// Yang dijaga di sini bukan sekadar "ada percabangan", tapi klaim yang dipakai rencana
// fase Instagram sebagai pijakan: jalur MASUK Instagram tidak perlu dibangun lagi. Kalau
// seseorang mempersempit isMessengerPayload kembali ke 'page' saja, rencana itu langsung
// berbohong -- dan pesan Instagram kembali dibuang diam-diam sambil membalas 200.
mustContain('src/lib/inbound.ts', /isMessengerPayload\(payload\)/, 'percabangan payload Messenger/Instagram')
mustContain('src/lib/inbound.ts', /payload\.object === 'instagram' \? 'INSTAGRAM'/, 'pemetaan object=instagram ke platform INSTAGRAM')
mustContain('src/lib/meta/messenger-types.ts', /object === 'page' \|\| object === 'instagram'/, "isMessengerPayload menerima 'page' DAN 'instagram'")

// Fase Instagram BELUM selesai: dua hal di bawah ini adalah sisa pekerjaannya. Keduanya
// dicatat sebagai klaim "belum ada" supaya pemeriksa ini ikut berubah saat fase itu jalan.
mustNotContain('src/lib/send.ts', /platform === 'INSTAGRAM'/, 'cabang kirim INSTAGRAM (fase Instagram, belum)')
mustNotContain('src/lib/channel/platform.ts', /SHIPPED_PLATFORMS = \[[^\]]*INSTAGRAM/, 'INSTAGRAM di SHIPPED_PLATFORMS (fase Instagram, belum)')
// Pencarian nama masih terpaku Facebook: dipanggil untuk KEDUA platform tanpa argumen
// platform, jadi IGSID ditanyakan ke Page Facebook. Harus jadi sadar-platform sebelum IG rilis.
mustNotContain('src/lib/meta/messenger-profile.ts', /platform/, 'messenger-profile sadar platform (fase Instagram, belum)')

// §6.3 — belum ada infrastruktur email sama sekali.
// Dipersempit ke IMPOR dan PEMAKAIAN, bukan sekadar penyebutan: komentar dokumentasi
// `externalThreadId` menyebut "threadId Gmail" sebagai penjelasan, dan versi lama
// pemeriksa ini salah membacanya sebagai infrastruktur email yang sudah terpasang.
for (const rel of ['src/lib/inbound.ts', 'src/lib/send.ts'])
  mustNotContain(rel, /from ['"](nodemailer|imap|googleapis)|gmail\.users|createTransport/i, 'impor/pemakaian email')

// ---------------------------------------------------------------------------
// §7 — dispatch keluar masih WhatsApp-saja
// ---------------------------------------------------------------------------
mustContain('src/lib/send.ts', /channel === 'OFFICIAL'/, "percabangan if (channel === 'OFFICIAL')")
mustContain('src/lib/channel-router.ts', /export async function resolveChannelForCapability\(/, 'resolveChannelForCapability()')
mustContain('src/lib/bot-control/channel-capabilities.ts', /OutboundChannel\s*=/, 'tipe OutboundChannel')

// ---------------------------------------------------------------------------
// §6.4 — pelabel email: model LOKAL, bukan model produksi
// ---------------------------------------------------------------------------
// Desain bergantung pada fakta bahwa model produksi adalah tag -cloud (teks keluar dari VPS).
// Kalau suatu saat produksi pindah ke tag lokal, seluruh argumen "pakai model terpisah untuk
// melabeli" runtuh dan §6.4 harus ditulis ulang.
mustContain('src/lib/bot/llm.ts', /const DEFAULT_OLLAMA_MODEL = '[^']*-cloud'/, 'model produksi masih tag -cloud')
mustContain('src/lib/bot/llm.ts', /Settings\.ollamaModel/, 'model bisa ditimpa per pemanggil lewat Settings.ollamaModel')

// Klaim "belum ada": pelabel dan enum labelnya belum dibangun.
mustNotContain('prisma/schema.prisma', /^enum MailLabel /m, 'enum MailLabel')
mustNotContain('prisma/schema.prisma', /mailLabelIsManual/, 'kolom mailLabelIsManual')

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
