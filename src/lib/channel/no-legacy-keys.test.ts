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
 *
 * Deteksinya struktural, bukan jarak-karakter: `where:` harus muncul sebelum `update:` atau
 * `create:` PERTAMA di dalam objek argumen upsert yang sama (lookahead negatif per-karakter
 * di bawah). Versi pertama file ini memakai jendela `[\s\S]{0,120}?` antara `upsert({` dan
 * `where:` -- lolos untuk kode polos, tapi gaya komentar repo ini sendiri (lihat
 * src/lib/inbound.ts:689-694, blok tiga baris di atas `where:`) rutin melewati 120 karakter
 * dan membuat pelanggaran BERKOMENTAR lolos tanpa suara. Jangkar struktural di bawah tidak
 * punya batas jarak sama sekali, jadi komentar sepanjang apa pun di atas `where:` tidak lagi
 * jadi jalan keluar -- satu-satunya cara lolos adalah `update:`/`create:` benar-benar
 * muncul lebih dulu, yang berarti bentuknya bukan lagi call yang sama.
 *
 * --- `findFirst`/`findUnique`/`findMany`, ditambahkan fix round 1 (Temuan I-2) dan fix round 2
 * (Temuan I-6) ---
 *
 * `contact.upsert`/`conversation.upsert` bukan satu-satunya bentuk berkunci lama: Task 9 fix
 * round 1 sendiri menambahkan `contact.findFirst({ where: { phone } })` di
 * src/app/api/send/route.ts, dan itu di luar jangkauan dua pola di atas -- `findFirst`/
 * `findUnique` tidak punya `update:`/`create:` untuk dijadikan jangkar negative-lookahead yang
 * sama. `findMany` menyusul di fix round 2: `contact.findMany({ where: { phone } })` lalu `[0]`
 * adalah bentuk terakhir yang masih dikompilasi setelah kedua unique dilepas, dan ia tetap
 * mengkodekan asumsi "satu nomor = satu kontak" yang balapan kontak ganda (Temuan I-4/I-5)
 * buktikan salah. Jangkar strukturalnya sama untuk ketiganya: hanya sintaks komentar (baris ganda `//` atau blok) dan
 * whitespace yang boleh berada di antara `{` pembuka argumen dan `where:`. Token lain apa pun
 * di sana berarti bentuknya bukan `{ where: { phone/contactId ... } }` yang dicari.
 *
 * Bentuk ini PUNYA pengecualian sah (lihat `src/app/api/send/route.ts` -- kompat nomor Task 46,
 * sengaja dikunci lewat `phone` + `orderBy: { createdAt: 'asc' }` untuk deterministik). Ditandai
 * eksplisit lewat komentar SATU BARIS tepat di atas call site: `// legacy-key-ok: <alasan>`.
 * Pengecualian yang harus ditulis sadar jauh lebih baik daripada penjaga yang diam-diam tidak
 * melihat polanya -- lihat `isMarkedLegacyKeyOk` di bawah.
 *
 * Tapi teks penanda itu bebas dan tak terbatas, jadi ia sendiri bisa disalahgunakan: siapa pun
 * bisa membungkam pelanggaran sungguhan dengan satu baris komentar dan tidak ada yang tahu
 * (Temuan I-6). Karena itu yang dipaku bukan hanya "nol pelanggaran", tapi HIMPUNAN penandanya
 * -- lokasi file dan teks alasannya, di `APPROVED_LEGACY_KEY_MARKERS` di bawah. Penanda baru,
 * penanda yang pindah file, atau alasan yang diubah semuanya menggagalkan test sampai daftar
 * itu ikut diedit dengan sadar. Hari ini isinya tepat satu.
 *
 * `contact.upsert`/`conversation.upsert` SENGAJA tidak diberi mekanisme pengecualian yang sama:
 * tidak ada pemakaian sah untuk pola itu di repo ini (semua sudah dimigrasikan ke
 * `channelIdentityId_externalThreadId`), jadi menambah jalan keluar di sana hanya menambah
 * permukaan yang bisa disalahgunakan tanpa alasan nyata.
 *
 * Batasan yang JUJUR harus dicatat, supaya jaminannya tidak dilebih-lebihkan:
 * - Pencocokan literal dan case-sensitive terhadap teks `contact.upsert(`/`conversation.upsert(`
 *   /`contact.findFirst(`/`contact.findUnique(`/`conversation.findFirst(`/
 *   `conversation.findUnique(` dan `where:`/`update:`/`create:` apa adanya. Delegate yang
 *   di-alias lewat variabel lain (mis. `const C = prisma.contact` lalu `C.upsert(...)`) TIDAK
 *   tertangkap. `prisma['contact'].upsert(...)` atau spread/destructuring lain yang menyamarkan
 *   nama metode juga tidak tertangkap.
 *   Untuk `upsert`: `where:` disyaratkan mendahului kunci `update:`/`create:` pada satu objek
 *   yang sama; kalau suatu saat kode menulis `create`/`update` sebelum `where` (urutan kunci
 *   yang valid secara JS tapi tidak pernah dipakai di repo ini sampai sekarang), penjaga ini
 *   akan gagal mendeteksinya -- ia mengandalkan konvensi urutan `{ where, update, create }`
 *   yang konsisten dipakai di seluruh repo, bukan aturan bahasa yang dijamin Prisma.
 *   Untuk `findFirst`/`findUnique`: hanya komentar `//`/`/* *\/` dan whitespace yang ditoleransi
 *   sebelum `where:` -- kalau suatu saat kode menaruh kunci lain (`select:`, `orderBy:`, dll.)
 *   SEBELUM `where:` di objek argumennya (bentuk yang valid secara Prisma tapi tidak pernah
 *   dipakai di repo ini), penjaga ini juga gagal mendeteksinya, persis batasan yang sama dengan
 *   `upsert` di atas.
 * - Hanya melaporkan KEBERADAAN pelanggaran per file (satu label per pola per file), bukan
 *   menghitung atau melokalisasi setiap kemunculan -- satu file dengan sepuluh pelanggaran
 *   tanpa penanda tetap satu baris di `offenders`.
 * - Hanya menggeledah `src/`; kode di luar itu (scripts/, docs/, dll.) tidak tersentuh.
 * - Penanda `legacy-key-ok` dicek pada TEPAT satu baris di atas baris yang memuat awal call
 *   site (`contact.findFirst(` dkk). Penanda yang ditaruh di baris lain (dua baris di atas, atau
 *   di akhir baris yang sama) tidak dikenali -- disengaja, supaya konvensinya satu bentuk saja
 *   dan mudah digrep.
 */

const COMMENT_OR_SPACE = String.raw`(?:(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)\s*)*`

const FIND_LEGACY_PATTERNS: Array<{ usage: string; regex: RegExp }> = [
  {
    usage: 'contact.findFirst({ where: { phone } })',
    regex: new RegExp(String.raw`contact\.findFirst\(\s*\{\s*${COMMENT_OR_SPACE}where:\s*\{\s*phone\b`, 'g'),
  },
  {
    usage: 'contact.findUnique({ where: { phone } })',
    regex: new RegExp(String.raw`contact\.findUnique\(\s*\{\s*${COMMENT_OR_SPACE}where:\s*\{\s*phone\b`, 'g'),
  },
  {
    usage: 'contact.findMany({ where: { phone } })',
    regex: new RegExp(String.raw`contact\.findMany\(\s*\{\s*${COMMENT_OR_SPACE}where:\s*\{\s*phone\b`, 'g'),
  },
  {
    usage: 'conversation.findFirst({ where: { contactId } })',
    regex: new RegExp(String.raw`conversation\.findFirst\(\s*\{\s*${COMMENT_OR_SPACE}where:\s*\{\s*contactId\b`, 'g'),
  },
  {
    usage: 'conversation.findUnique({ where: { contactId } })',
    regex: new RegExp(String.raw`conversation\.findUnique\(\s*\{\s*${COMMENT_OR_SPACE}where:\s*\{\s*contactId\b`, 'g'),
  },
  {
    usage: 'conversation.findMany({ where: { contactId } })',
    regex: new RegExp(String.raw`conversation\.findMany\(\s*\{\s*${COMMENT_OR_SPACE}where:\s*\{\s*contactId\b`, 'g'),
  },
]

/**
 * Penanda `// legacy-key-ok: <alasan>` yang BOLEH ada di repo ini, lengkap dengan lokasi dan
 * alasannya. Dipaku sebagai himpunan, bukan sekadar dihitung: mekanisme pengecualian yang
 * teksnya bebas dan jumlahnya tak dibatasi bisa dipakai siapa pun untuk mendiamkan pelanggaran
 * sungguhan tanpa ada yang tahu. Dengan daftar ini, menambah pengecualian baru berarti
 * mengedit file ini dengan sadar -- dan penanda yang muncul di tempat yang tidak terduga
 * membuat test GAGAL, bukan lolos diam-diam.
 */
const APPROVED_LEGACY_KEY_MARKERS: Array<{ file: string; reason: string }> = [
  {
    file: join('src', 'app', 'api', 'send', 'route.ts'),
    reason:
      'kompat Task 46 -- phone tak lagi unik sejak Task 9, orderBy createdAt asc di bawah membuat pilihannya deterministik (lihat komentar di atas modul ini, dan Temuan I-1 fix round 1)',
  },
]

/** Setiap `// legacy-key-ok: <alasan>` di satu file, alasannya saja, urut kemunculan. */
export function findLegacyKeyMarkers(source: string): string[] {
  return source
    .split('\n')
    .map((line) => /^\s*\/\/\s*legacy-key-ok:\s*(.*)$/.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => match[1].trim())
}

/**
 * True kalau baris TEPAT di atas posisi `matchIndex` (yaitu di atas baris yang memuat awal call
 * site) adalah komentar penanda `// legacy-key-ok: <alasan>`. Lihat catatan di kepala file ini
 * soal kenapa hanya `findFirst`/`findUnique` yang punya jalan keluar ini.
 */
function isMarkedLegacyKeyOk(source: string, matchIndex: number): boolean {
  const before = source.slice(0, matchIndex)
  const lines = before.split('\n')
  const previousLine = lines[lines.length - 2] ?? ''
  return /^\s*\/\/\s*legacy-key-ok:/.test(previousLine)
}

export function findLegacyKeyUsages(source: string): string[] {
  const usages: string[] = []
  if (/contact\.upsert\(\s*\{(?:(?!update:|create:)[\s\S])*?where:\s*\{\s*phone/.test(source)) {
    usages.push('contact.upsert({ where: { phone } })')
  }
  if (/conversation\.upsert\(\s*\{(?:(?!update:|create:)[\s\S])*?where:\s*\{\s*contactId/.test(source)) {
    usages.push('conversation.upsert({ where: { contactId } })')
  }

  for (const { usage, regex } of FIND_LEGACY_PATTERNS) {
    regex.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = regex.exec(source))) {
      if (!isMarkedLegacyKeyOk(source, match.index)) {
        usages.push(usage)
        break // satu label per pola per file, sama seperti upsert di atas.
      }
    }
  }

  return usages
}

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p))
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(p)
  }
  return out
}

describe('tidak ada lagi upsert/lookup berkunci lama tanpa penanda di seluruh repo', () => {
  it('nol contact.upsert({ where: { phone } }) dan conversation.upsert({ where: { contactId } })', () => {
    const offenders: string[] = []

    for (const file of sourceFiles('src')) {
      const src = readFileSync(file, 'utf8')
      for (const usage of findLegacyKeyUsages(src)) offenders.push(`${file}: ${usage}`)
    }

    expect(offenders).toEqual([])
  })

  // Temuan I-6: penjaga yang hanya menghitung pelanggaran memberi jalan keluar yang tak
  // terbatas -- satu baris `// legacy-key-ok:` di mana pun membuat pelanggaran sungguhan
  // menghilang dari `offenders` di atas tanpa ada yang menyadarinya. Yang dipaku di sini adalah
  // HIMPUNAN penandanya: lokasi file DAN teks alasannya. Penanda baru, penanda yang pindah
  // file, atau alasan yang diubah, semuanya menggagalkan test ini sampai daftar
  // APPROVED_LEGACY_KEY_MARKERS ikut diedit dengan sadar.
  it('hanya penanda legacy-key-ok yang sudah disetujui yang ada di seluruh src/', () => {
    const found: Array<{ file: string; reason: string }> = []

    for (const file of sourceFiles('src')) {
      for (const reason of findLegacyKeyMarkers(readFileSync(file, 'utf8'))) found.push({ file, reason })
    }

    const sort = (rows: Array<{ file: string; reason: string }>) =>
      [...rows].sort((a, b) => `${a.file}\u0000${a.reason}`.localeCompare(`${b.file}\u0000${b.reason}`))

    expect(sort(found)).toEqual(sort(APPROVED_LEGACY_KEY_MARKERS))
  })
})

describe('findLegacyKeyUsages (kontrol positif)', () => {
  // Penjaga yang hanya pernah dijalankan terhadap kode yang bersih tidak pernah membuktikan
  // ia bisa GAGAL -- persis kondisi yang membuat jendela 120-karakter lolos tanpa terdeteksi
  // sampai direview manual. Test ini menjalankan fungsi deteksi yang SAMA (bukan salinannya)
  // terhadap fixture yang sengaja melanggar, supaya penjaga di atas dan kontrol di sini tidak
  // mungkin diam-diam berbeda perilaku.
  it('mendeteksi conversation.upsert({ where: { contactId } }) polos', () => {
    const src = `
      await prisma.conversation.upsert({
        where: { contactId: contact.id },
        update: {},
        create: { contactId: contact.id, isPinned: true, isTest: true },
      })
    `
    expect(findLegacyKeyUsages(src)).toContain('conversation.upsert({ where: { contactId } })')
  })

  it('mendeteksi conversation.upsert({ where: { contactId } }) walau didahului komentar penjelas tiga baris', () => {
    // Bentuk persis yang lolos dari jendela 120-karakter lama -- lihat src/lib/inbound.ts:689-694
    // untuk gaya komentar nyata yang memicu temuan ini.
    const src = `
      const conversation = await prisma.conversation.upsert({
        // Dikunci lewat (channelIdentityId, externalThreadId), bukan contactId: setelah Task 9
        // melepas Conversation.contactId @unique, Prisma menolak contactId di \`where\` sebuah
        // upsert karena ia bukan lagi field unik -- baris komentar ini sengaja panjang.
        where: { contactId: contact.id },
        update: { lastMessageAt: sentAt },
        create: { contactId: contact.id, channelIdentityId: identity.id },
      })
    `
    expect(findLegacyKeyUsages(src)).toContain('conversation.upsert({ where: { contactId } })')
  })

  it('mendeteksi contact.upsert({ where: { phone } }) polos', () => {
    const src = `
      const contact = await prisma.contact.upsert({
        where: { phone },
        update: {},
        create: { phone, name },
      })
    `
    expect(findLegacyKeyUsages(src)).toContain('contact.upsert({ where: { phone } })')
  })

  it('mendeteksi contact.upsert({ where: { phone } }) walau didahului komentar penjelas tiga baris', () => {
    const src = `
      const contact = await prisma.contact.upsert({
        // Dicari lewat nomor -- ini contoh kode yang belum dimigrasikan sama sekali, dan
        // pemanggilnya masih mengandalkan keunikan Contact.phone yang lama, persis pola
        // yang menjadi target penjaga ini.
        where: { phone },
        update: {},
        create: { phone, name },
      })
    `
    expect(findLegacyKeyUsages(src)).toContain('contact.upsert({ where: { phone } })')
  })

  it('tidak menandai kode yang sudah dimigrasikan ke channelIdentityId_externalThreadId', () => {
    const src = `
      const conversation = await prisma.conversation.upsert({
        // Dikunci lewat (channelIdentityId, externalThreadId), bukan contactId: setelah Task 9
        // melepas Conversation.contactId @unique, Prisma menolak contactId di \`where\` sebuah
        // upsert karena ia bukan lagi field unik.
        where: {
          channelIdentityId_externalThreadId: { channelIdentityId: identity.id, externalThreadId: '' },
        },
        update: { lastMessageAt: sentAt },
        create: { contactId: contact.id, channelIdentityId: identity.id, externalThreadId: '' },
      })
    `
    expect(findLegacyKeyUsages(src)).toEqual([])
  })

  // --- findFirst/findUnique, keempat bentuk (Temuan I-2) ---

  it('mendeteksi contact.findFirst({ where: { phone } }) polos', () => {
    const src = `
      const contact = await prisma.contact.findFirst({
        where: { phone: to },
        include: { conversations: true },
      })
    `
    expect(findLegacyKeyUsages(src)).toContain('contact.findFirst({ where: { phone } })')
  })

  it('mendeteksi contact.findUnique({ where: { phone } }) polos', () => {
    const src = `
      const contact = await prisma.contact.findUnique({
        where: { phone: to },
      })
    `
    expect(findLegacyKeyUsages(src)).toContain('contact.findUnique({ where: { phone } })')
  })

  it('mendeteksi conversation.findFirst({ where: { contactId } }) polos', () => {
    const src = `
      const conversation = await prisma.conversation.findFirst({
        where: { contactId: contact.id },
      })
    `
    expect(findLegacyKeyUsages(src)).toContain('conversation.findFirst({ where: { contactId } })')
  })

  it('mendeteksi conversation.findUnique({ where: { contactId } }) polos', () => {
    const src = `
      const conversation = await prisma.conversation.findUnique({
        where: { contactId: contact.id },
      })
    `
    expect(findLegacyKeyUsages(src)).toContain('conversation.findUnique({ where: { contactId } })')
  })

  it('mendeteksi contact.findFirst({ where: { phone } }) walau didahului komentar penjelas tiga baris', () => {
    const src = `
      const contact = await prisma.contact.findFirst({
        // Dicari lewat nomor -- ini contoh kode yang belum dimigrasikan, dan pemanggilnya
        // masih mengandalkan keunikan Contact.phone yang lama, persis pola yang menjadi
        // target penjaga ini.
        where: { phone: to },
      })
    `
    expect(findLegacyKeyUsages(src)).toContain('contact.findFirst({ where: { phone } })')
  })

  it('TIDAK menandai contact.findFirst({ where: { phone } }) yang ditandai // legacy-key-ok tepat di atasnya', () => {
    const src = `
      // legacy-key-ok: kompat nomor Task 46, orderBy createdAt asc membuat pilihannya deterministik
      const contact = await prisma.contact.findFirst({
        where: { phone: to },
        orderBy: { createdAt: 'asc' },
        include: { conversations: { orderBy: { lastMessageAt: 'desc' }, take: 1 } },
      })
    `
    expect(findLegacyKeyUsages(src)).toEqual([])
  })

  it('TIDAK menandai conversation.findUnique({ where: { contactId } }) yang ditandai // legacy-key-ok tepat di atasnya', () => {
    const src = `
      // legacy-key-ok: contoh sintetis untuk kontrol positif penanda, bukan kode nyata
      const conversation = await prisma.conversation.findUnique({
        where: { contactId: contact.id },
      })
    `
    expect(findLegacyKeyUsages(src)).toEqual([])
  })

  it('tetap menandai kalau penanda ada tapi BUKAN tepat satu baris di atas call site', () => {
    // Penanda dua baris di atas (bukan tepat di atas) tidak dikenali -- disengaja, lihat
    // catatan di kepala file.
    const src = `
      // legacy-key-ok: ini seharusnya tidak menolong karena bukan baris tepat di atas
      const noop = 1
      const contact = await prisma.contact.findFirst({
        where: { phone: to },
      })
    `
    expect(findLegacyKeyUsages(src)).toContain('contact.findFirst({ where: { phone } })')
  })

  // --- findMany, ditambahkan fix round 2 (Temuan I-6) ---
  //
  // `contact.findMany({ where: { phone } })` lalu `[0]` adalah bentuk terakhir yang MASIH
  // dikompilasi setelah kedua unique dilepas, dan ia tetap mengkodekan asumsi lama "satu nomor
  // = satu kontak" -- justru asumsi yang balapan kontak ganda (Temuan I-4/I-5) buktikan salah.
  it('mendeteksi contact.findMany({ where: { phone } }) yang diambil [0]-nya', () => {
    const src = `
      const contacts = await prisma.contact.findMany({
        where: { phone: to },
      })
      const contact = contacts[0]
    `
    expect(findLegacyKeyUsages(src)).toContain('contact.findMany({ where: { phone } })')
  })

  it('mendeteksi contact.findMany({ where: { phone } }) walau didahului komentar penjelas tiga baris', () => {
    const src = `
      const contacts = await prisma.contact.findMany({
        // Dicari lewat nomor, lalu diambil yang pertama -- persis asumsi "satu nomor = satu
        // kontak" yang sudah tidak berlaku sejak Task 9 melepas Contact.phone @unique, dan
        // komentar sepanjang ini tidak boleh jadi jalan keluar.
        where: { phone: to },
      })
    `
    expect(findLegacyKeyUsages(src)).toContain('contact.findMany({ where: { phone } })')
  })

  it('mendeteksi conversation.findMany({ where: { contactId } }) polos', () => {
    const src = `
      const conversations = await prisma.conversation.findMany({
        where: { contactId: contact.id },
      })
    `
    expect(findLegacyKeyUsages(src)).toContain('conversation.findMany({ where: { contactId } })')
  })

  it('TIDAK menandai contact.findMany({ where: { phone } }) yang ditandai // legacy-key-ok tepat di atasnya', () => {
    const src = `
      // legacy-key-ok: contoh sintetis untuk kontrol positif penanda, bukan kode nyata
      const contacts = await prisma.contact.findMany({
        where: { phone: to },
      })
    `
    expect(findLegacyKeyUsages(src)).toEqual([])
  })

  // --- findLegacyKeyMarkers, kontrol positif untuk pemakuan himpunan penanda (Temuan I-6) ---

  it('findLegacyKeyMarkers mengembalikan setiap alasan penanda, tidak hanya menghitungnya', () => {
    const src = `
      // legacy-key-ok: alasan pertama
      const a = await prisma.contact.findFirst({ where: { phone: to } })
      // legacy-key-ok: alasan kedua
      const b = await prisma.contact.findMany({ where: { phone: to } })
    `
    expect(findLegacyKeyMarkers(src)).toEqual(['alasan pertama', 'alasan kedua'])
  })

  it('findLegacyKeyMarkers tidak melihat penanda di akhir baris kode (konvensinya satu bentuk saja)', () => {
    const src = `
      const a = await prisma.contact.findFirst({ where: { phone: to } }) // legacy-key-ok: bukan bentuknya
    `
    expect(findLegacyKeyMarkers(src)).toEqual([])
  })

  it('tidak salah tertangkap oleh model lain yang kebetulan memuat "contact" sebagai substring (contactConsent)', () => {
    // src/app/api/contacts/[id]/consent/route.ts memakai prisma.contactConsent.findUnique({
    // where: { contactId } }) -- contactId di sana adalah field @unique ASLI milik model
    // ContactConsent sendiri, tidak berhubungan dengan Conversation.contactId yang dilonggarkan
    // Task 9. Regex `contact\\.findUnique\\(`/`conversation\\.findUnique\\(` tidak boleh cocok di sini.
    const src = `
      const consent = await prisma.contactConsent.findUnique({ where: { contactId: id } })
    `
    expect(findLegacyKeyUsages(src)).toEqual([])
  })
})
