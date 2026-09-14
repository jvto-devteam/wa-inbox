/**
 * Kalimat kebijakan yang dikonfirmasi operator dan dikirim ke model sebagai disclosure.
 *
 * Modul sendiri, tanpa satu impor pun, dan dua-duanya load-bearing:
 *
 *   - knowledge.ts memakainya untuk DISCLOSURES (teks prompt), dan reply-attribution.ts memakainya
 *     sebagai kandidat pencocok sumber. Satu salinan untuk keduanya, jadi kalimat yang dikirim ke
 *     model dan kalimat yang dianggap "bersumber" tidak bisa berbeda diam-diam.
 *   - reply-attribution.ts diimpor BotTracePopover (komponen browser). knowledge.ts mengimpor
 *     catalog.ts yang membaca file di server, jadi pencocok tidak boleh mengimpornya langsung --
 *     kelas galat yang sama yang mematikan build produksi 2026-09-14 (lihat matcher-stopwords.ts).
 *
 * Kenapa ini ada (dilaporkan 2026-09-14): jawaban yang menyatakan kebijakan ketersediaan ("nearly
 * always available... confirmed automatically at checkout") selalu ditandai "tidak punya
 * knowledge", karena pencocok hanya membaca baris katalog dan knowledge terkelola. Kebijakannya
 * benar dan sudah dikonfirmasi; yang keliru pemeriksanya. Akibatnya daftar gap penuh alarm palsu di
 * hampir setiap pertanyaan yang menyinggung harga, dan operator diminta "menambah knowledge" untuk
 * pertanyaan yang sudah dijawab dengan benar.
 *
 * Teks di bawah WAJIB identik byte demi byte dengan yang dulu tertulis di knowledge.ts: ia ikut
 * prompt. policy-statements.test.ts menjaganya.
 */

/** Dikonfirmasi operator 2026-08-05 -- lihat komentar DISCLOSURES di knowledge.ts. */
export const AVAILABILITY_POLICY =
  'Nearly always available -- exact availability for a specific date is confirmed automatically at checkout, so encourage the customer to go ahead and book rather than asking for their dates first "to verify".'

export const NO_GUARANTEE_POLICY =
  'Attraction access such as Blue Fire, along with weather and sunrise, cannot be guaranteed; it depends on current conditions and the authorities.'

/**
 * Kalimat untuk alternatif terdekat, dikonfirmasi operator 2026-08-05 (lihat matchTierNote di
 * orchestrator.ts). Ditambahkan ke sini 2026-09-14: uji ulang Arpan menunjukkan parafrasanya ("we
 * don't have a standard package... our team can adjust the specifics after booking") ditandai
 * "tanpa sumber", kelas yang sama dengan kebijakan ketersediaan. Berbentuk arahan untuk model,
 * bukan larangan: isinya dua pernyataan yang boleh disampaikan ke pelanggan.
 */
export const NOT_STANDARD_PACKAGE_POLICY =
  "Be upfront that the exact combination they wanted isn't a standard package, and mention that our team can adjust the specifics after booking if needed."

/**
 * Pilihan operator 2026-09-14 untuk jemput setelah jam 12:00 (lihat pickupRouteAdvice di
 * scenario-evaluator.ts): Bromo dulu disarankan, tapi semua paket Surabaya -> Surabaya yang ada mulai
 * dari Ijen. Paketnya tetap ditawarkan, dan pelanggan diberi tahu urutannya bisa dibalik setelah booking.
 * Kata-katanya sengaja berbeda dari NOT_STANDARD_PACKAGE_POLICY ("standard", "team", "after booking"):
 * pencocok sumber menghitung kata isi yang sama, dan kalimat yang terlalu mirip membuat balasan "paket
 * tidak standar" ikut dianggap bersumber dari kebijakan urutan rute.
 */
export const PICKUP_ROUTE_ORDER_POLICY =
  'Say that these packages normally begin at Ijen, and that our team can reverse the order to visit Bromo first once booked.'

/**
 * Kandidat pencocok sumber. Sengaja hanya PERNYATAAN kebijakan, bukan baris GUARDRAIL_INSTRUCTION:
 * baris guardrail adalah larangan untuk model ("NEVER ..."), bukan fakta yang boleh disampaikan ke
 * pelanggan, jadi balasan yang mirip dengannya tidak otomatis bersumber.
 */
export const POLICY_STATEMENTS: ReadonlyArray<{ title: string; line: string }> = [
  { title: 'Kebijakan ketersediaan', line: AVAILABILITY_POLICY },
  { title: 'Kebijakan tanpa jaminan akses', line: NO_GUARANTEE_POLICY },
  { title: 'Kebijakan paket tidak standar', line: NOT_STANDARD_PACKAGE_POLICY },
  { title: 'Kebijakan urutan rute setelah booking', line: PICKUP_ROUTE_ORDER_POLICY },
]
