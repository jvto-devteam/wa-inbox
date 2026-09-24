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
 * Batasan yang JUJUR harus dicatat, supaya jaminannya tidak dilebih-lebihkan:
 * - Pencocokan literal dan case-sensitive terhadap teks `contact.upsert(`/`conversation.upsert(`
 *   dan `where:`/`update:`/`create:` apa adanya. Delegate yang di-alias lewat variabel lain
 *   (mis. `const C = prisma.contact` lalu `C.upsert(...)`) TIDAK tertangkap.
 *   `prisma['contact'].upsert(...)` atau spread/destructuring lain yang menyamarkan nama
 *   metode juga tidak tertangkap.
 *   `where:` disyaratkan array data ini mendahului kunci `update:`/`create:` pada satu objek
 *   yang sama; kalau suatu saat kode menulis `create`/`update` sebelum `where` (urutan kunci
 *   yang valid secara JS tapi tidak pernah dipakai di repo ini sampai sekarang), penjaga ini
 *   akan gagal mendeteksinya -- ia mengandalkan konvensi urutan `{ where, update, create }`
 *   yang konsisten dipakai di seluruh repo, bukan aturan bahasa yang dijamin Prisma.
 * - Hanya melaporkan KEBERADAAN pelanggaran per file (lewat `.test()`), bukan menghitung atau
 *   melokalisasi setiap kemunculan -- satu file dengan sepuluh pelanggaran tetap satu baris di
 *   `offenders`.
 * - Hanya menggeledah `src/`; kode di luar itu (scripts/, docs/, dll.) tidak tersentuh.
 */
export function findLegacyKeyUsages(source: string): string[] {
  const usages: string[] = []
  if (/contact\.upsert\(\s*\{(?:(?!update:|create:)[\s\S])*?where:\s*\{\s*phone/.test(source)) {
    usages.push('contact.upsert({ where: { phone } })')
  }
  if (/conversation\.upsert\(\s*\{(?:(?!update:|create:)[\s\S])*?where:\s*\{\s*contactId/.test(source)) {
    usages.push('conversation.upsert({ where: { contactId } })')
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

describe('tidak ada lagi upsert berkunci lama di seluruh repo', () => {
  it('nol contact.upsert({ where: { phone } }) dan conversation.upsert({ where: { contactId } })', () => {
    const offenders: string[] = []

    for (const file of sourceFiles('src')) {
      const src = readFileSync(file, 'utf8')
      for (const usage of findLegacyKeyUsages(src)) offenders.push(`${file}: ${usage}`)
    }

    expect(offenders).toEqual([])
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
})
