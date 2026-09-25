#!/usr/bin/env node
/**
 * Pemeriksa mekanis untuk 2026-09-25-omnichannel-instagram.md.
 *
 * Rencana itu menyuruh implementer "ganti X menjadi Y" di file-file nyata. Kalau X tidak ada
 * PERSIS seperti yang dikutip, instruksinya tidak bisa dijalankan -- dan itu baru ketahuan
 * saat seseorang sudah di tengah eksekusi. Pemeriksa ini menguji setiap kutipan itu ada.
 *
 * Ia juga menguji klaim "sudah ada" di tabel keadaan awal, karena klaim itulah yang dipakai
 * rencana untuk membenarkan tugas mana yang TIDAK perlu dikerjakan. Klaim "sudah ada" yang
 * salah menghasilkan fase yang melewatkan pekerjaan nyata.
 *
 * Keluar dengan kode != 0 berarti RENCANANYA yang salah, bukan reponya.
 *
 * Jalankan: node docs/superpowers/plans/check-instagram-plan.mjs
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const failures = []
let checked = 0

function read(rel) {
  const p = join(ROOT, rel)
  return existsSync(p) ? readFileSync(p, 'utf8') : null
}

/** File yang dikutip rencana harus ada. */
function fileExists(rel) {
  checked++
  if (!existsSync(join(ROOT, rel))) failures.push(`file yang dikutip rencana tidak ada: ${rel}`)
}

/**
 * Potongan yang rencana suruh GANTI harus ada persis, kalau tidak instruksinya mati.
 *
 * `includes` saja TIDAK CUKUP untuk jangkar yang merupakan awalan dari bentuk yang lebih
 * panjang. Terbukti saat pemeriksa ini diuji-mutasi: jangkar
 * `platform?: 'WHATSAPP' | 'FACEBOOK'` tetap lolos setelah tipenya dilebarkan menjadi
 * `platform?: 'WHATSAPP' | 'FACEBOOK' | 'INSTAGRAM'`, karena yang panjang MEMUAT yang
 * pendek. Rencana lalu menyuruh melebarkan tipe yang sudah lebar -- dan pemeriksanya diam.
 *
 * `endOfLine: true` mengikat jangkar ke akhir baris, sehingga pelebaran apa pun memutuskannya.
 * Dipakai untuk setiap jangkar yang merupakan awalan sah dari bentuk lain.
 */
function anchorExists(rel, literal, why, { endOfLine = false } = {}) {
  checked++
  const src = read(rel)
  if (src === null) return failures.push(`file hilang: ${rel} (butuh jangkar: ${why})`)
  const found = endOfLine ? src.includes(`${literal}\n`) : src.includes(literal)
  if (!found) {
    failures.push(`${rel}: jangkar "ganti ini" TIDAK DITEMUKAN -> ${why}\n      dicari: ${JSON.stringify(literal)}${endOfLine ? ' (harus di akhir baris)' : ''}`)
  }
}

/** Klaim "sudah ada" di tabel keadaan awal. */
function claimPresent(rel, pattern, why) {
  checked++
  const src = read(rel)
  if (src === null) return failures.push(`file hilang: ${rel} (butuh: ${why})`)
  if (!pattern.test(src)) failures.push(`${rel}: klaim "sudah ada" SALAH -> ${why}`)
}

/** Klaim "belum ada" -- kalau sudah ada, rencananya menyuruh membangun yang sudah terbangun. */
function claimAbsent(rel, pattern, why) {
  checked++
  const src = read(rel)
  if (src === null) return failures.push(`file hilang: ${rel} (butuh: TIDAK ada ${why})`)
  if (pattern.test(src)) failures.push(`${rel}: klaim "belum ada" SALAH, sudah terbangun -> ${why}`)
}

/** Baris yang dikutip rencana (file:N) harus benar-benar memuat polanya. */
function lineHas(rel, lineNo, pattern, why) {
  checked++
  const src = read(rel)
  if (src === null) return failures.push(`file hilang: ${rel}`)
  const line = src.split('\n')[lineNo - 1] ?? ''
  if (!pattern.test(line)) failures.push(`${rel}:${lineNo} tidak memuat ${why} — isinya: ${line.trim().slice(0, 80)}`)
}

// ---------------------------------------------------------------------------
// File yang disentuh rencana
// ---------------------------------------------------------------------------
for (const f of [
  'src/lib/meta/messenger-profile.ts',
  'src/lib/meta/messenger-profile.test.ts',
  'src/lib/meta/messenger-send.ts',
  'src/lib/meta/messenger-send.test.ts',
  'src/lib/inbound-messenger.ts',
  'src/lib/send.ts',
  'src/lib/send.test.ts',
  'src/lib/test-conversation.ts',
  'src/lib/test-conversation.test.ts',
  'src/lib/channel/platform.ts',
  'src/lib/channel/platform.test.ts',
  'src/components/inbox/ConversationList.test.tsx',
  'docs/superpowers/specs/check-omnichannel-design.mjs',
]) fileExists(f)

// ---------------------------------------------------------------------------
// Jangkar "ganti ini menjadi itu" -- bagian paling rapuh dari rencana mana pun
// ---------------------------------------------------------------------------
anchorExists('src/lib/inbound-messenger.ts',
  'displayName = await fetchMessengerProfileName(event.sender.id)',
  'Tugas 1 Step 4 meneruskan platform')

anchorExists('src/lib/send.ts',
  "platform?: 'WHATSAPP' | 'FACEBOOK'",
  'Tugas 3 Step 3 melebarkan tipe platform',
  { endOfLine: true })

anchorExists('src/lib/send.ts',
  "if (platform === 'FACEBOOK') {\n    return sendMessengerMessage(params, botTrace, conversation)\n  }",
  'Tugas 3 Step 4 merutekan kedua platform')

anchorExists('src/lib/send.ts',
  'const result = await sendMessengerText(recipientId, params.text)',
  'Tugas 3 Step 5 meneruskan platform ke pengiriman')

anchorExists('src/lib/test-conversation.ts',
  'contactId: contact.contactId,',
  'Tugas 4 Step 3 memakai identity.contactId')

anchorExists('src/lib/channel/platform.ts',
  "export const SHIPPED_PLATFORMS = ['WHATSAPP', 'FACEBOOK'] as const satisfies readonly Platform[]",
  'Tugas 5 Step 3 menambahkan INSTAGRAM')

anchorExists('src/lib/channel/platform.test.ts',
  "expect(SHIPPED_PLATFORMS).toEqual(['WHATSAPP', 'FACEBOOK'])",
  'Tugas 5 Step 1 memperbarui harapan')

anchorExists('src/lib/meta/messenger-profile.ts',
  'export async function fetchMessengerProfileName(psid: string): Promise<string | null> {',
  'Tugas 1 Step 3 mengganti tanda tangan')

anchorExists('src/lib/meta/messenger-send.ts',
  'export async function sendMessengerText(\n  recipientId: string,\n  text: string,\n): Promise<{ externalId: string }> {',
  'Tugas 2 Step 3 mengganti tanda tangan')

anchorExists('src/lib/send.ts',
  '  conversation: { channelIdentity: { externalId: string } | null },\n) {',
  'Tugas 3 Step 5 menambah parameter platform ke sendMessengerMessage')

// Konstanta yang dipakai ulang oleh kode baru di Tugas 1 harus benar-benar ada di file itu.
for (const konstanta of ['GRAPH_VERSION', 'LOOKUP_TIMEOUT_MS', 'DEFAULT_PAGE_ID'])
  anchorExists('src/lib/meta/messenger-profile.ts', `const ${konstanta}`, `kode Tugas 1 memakai ${konstanta}`)

// ---------------------------------------------------------------------------
// Tabel "keadaan awal" -- klaim SUDAH ADA
// ---------------------------------------------------------------------------
claimPresent('prisma/schema.prisma', /^enum Platform /m, 'enum Platform')
claimPresent('prisma/schema.prisma', /INSTAGRAM/, 'nilai INSTAGRAM di enum Platform')
claimPresent('prisma/schema.prisma', /botEnabledInstagram\s+Boolean\s+@default\(false\)/, 'Settings.botEnabledInstagram default false')
claimPresent('src/app/api/bot/channel-toggle/route.ts', /z\.enum\(\['WHATSAPP', 'INSTAGRAM', 'FACEBOOK', 'EMAIL'\]\)/, 'channel-toggle menerima INSTAGRAM')
claimPresent('src/app/(authenticated)/chatbot/page.tsx', /INSTAGRAM: \{ label: 'Instagram', key: 'botEnabledInstagram' \}/, 'sakelar Instagram di UI chatbot')
claimPresent('src/lib/meta/messenger-types.ts', /object === 'page' \|\| object === 'instagram'/, "isMessengerPayload menerima 'instagram'")
claimPresent('src/lib/inbound.ts', /payload\.object === 'instagram' \? 'INSTAGRAM'/, 'dispatch instagram -> INSTAGRAM')
claimPresent('src/lib/inbound-messenger.ts', /platform: Extract<Platform, 'FACEBOOK' \| 'INSTAGRAM'>/, 'adapter sudah bertipe dua platform')
claimPresent('src/lib/inbound.ts', /export async function defaultBotEnabled\(input: \{ platform: Platform/, 'defaultBotEnabled sadar platform')
claimPresent('src/app/api/send/route.ts', /conversationId: z\.string\(\)/, 'route kirim menerima conversationId')
claimPresent('src/lib/channel/identity.ts', /Promise<\{ id: string; contactId: string \}>/, 'kontrak upsertChannelIdentity')
claimPresent('src/lib/test-conversation.ts', /upsertChannelIdentity/, 'test-conversation memanggil upsertChannelIdentity')

// Baris yang dikutip persis di tabel keadaan awal.
// Diikat dengan $ untuk alasan yang sama seperti endOfLine di atas: tanpa itu, tipe yang
// sudah dilebarkan tetap lolos karena yang panjang memuat yang pendek.
lineHas('src/lib/send.ts', 94, /platform\?: 'WHATSAPP' \| 'FACEBOOK'\s*$/, 'tipe platform yang dikutip')
lineHas('src/app/api/bot/channel-toggle/route.ts', 34, /INSTAGRAM/, 'enum platform yang dikutip')
lineHas('src/app/(authenticated)/chatbot/page.tsx', 60, /Instagram/, 'sakelar Instagram yang dikutip')
lineHas('src/lib/inbound.ts', 861, /instagram/, 'dispatch instagram yang dikutip')
lineHas('prisma/schema.prisma', 786, /botEnabledInstagram/, 'kolom yang dikutip')

// ---------------------------------------------------------------------------
// Tabel "keadaan awal" -- klaim BELUM ADA (kalau salah, rencana menyuruh membangun ulang)
// ---------------------------------------------------------------------------
claimAbsent('src/lib/meta/messenger-profile.ts', /platform/, 'messenger-profile belum sadar platform')
claimAbsent('src/lib/meta/messenger-send.ts', /platform/, 'messenger-send belum sadar platform')
claimAbsent('src/lib/send.ts', /platform === 'INSTAGRAM'/, 'belum ada cabang kirim INSTAGRAM')
claimAbsent('src/lib/channel/platform.ts', /SHIPPED_PLATFORMS = \[[^\]]*INSTAGRAM/, 'INSTAGRAM belum di SHIPPED_PLATFORMS')

// ---------------------------------------------------------------------------
// Pemeriksa spec induk harus hijau -- rencana berpijak pada klaim-klaimnya
// ---------------------------------------------------------------------------
fileExists('docs/superpowers/specs/2026-09-23-omnichannel-inbox-design.md')
fileExists('docs/superpowers/specs/check-omnichannel-design.mjs')

// ---------------------------------------------------------------------------
console.log(`rencana-instagram: ${checked} klaim diperiksa`)
if (failures.length) {
  console.error(`\n✗ ${failures.length} klaim rencana tidak cocok dengan repo:\n`)
  for (const f of failures) console.error(`  - ${f}`)
  console.error('\nRENCANANYA yang salah. Perbaiki sebelum dieksekusi.\n')
  process.exit(1)
}
console.log('✓ semua klaim dan jangkar di 2026-09-25-omnichannel-instagram.md cocok dengan repo')
