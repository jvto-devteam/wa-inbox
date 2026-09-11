/**
 * Task 22 (Ruling R101): what topic(s) beyond the primary one a customer message ALSO asks
 * about, so a single multi-question message can be answered for every topic it raises, not
 * just the one `topic-classifier.ts` picks as primary.
 *
 * --- Kenapa panggilan LLM TERPISAH, bukan memperluas prompt classifyTopicViaLLM ---
 *
 * Percobaan pertama (commit fefbe22, reverted b75bc4f) mengubah PROMPT topic-classifier.ts
 * sendiri untuk juga meminta daftar topik tambahan dalam satu panggilan -- dan gagal gerbang
 * ukur akurasi topik UTAMA-nya sendiri (96% -> 93%). topic-classifier.ts menjawab satu
 * pertanyaan sempit ("topik UTAMA pesan ini apa?") yang sudah dituning dan diukur; menambahi
 * tugas kedua ke prompt yang sama mengalihkan model dan menurunkan akurasi tugas pertama.
 * Operator memilih +1 panggilan LLM per pesan, berjalan PARALEL dengan classifyTopicViaLLM
 * (lihat orchestrator.ts's kedua `Promise.all` call site) -- tidak menambah latensi seri --
 * dengan syarat KERAS: topic-classifier.ts tidak boleh disentuh sama sekali (lihat CLAUDE.md
 * dan header file itu).
 *
 * --- Kenapa bentuk ini mirip fact-topic-classifier.ts, bukan topic-classifier.ts ---
 *
 * Pertanyaannya sama-sama "topik APA SAJA", bukan "topik APA (tunggal)" -- multi-label, sama
 * seperti fact-topic-classifier.ts menandai satu FAKTA dengan beberapa topik. Bedanya cuma
 * subjeknya: fact-topic-classifier menandai satu entri knowledge terkelola SEKALI saat
 * disimpan; ini menandai satu PESAN PELANGGAN setiap giliran, dan dibatasi `MAX_TOPICS` (6,
 * lihat header konstanta itu) supaya knowledge terkelola/katalog yang digabungkan (lihat
 * orchestrator.ts's mergeKnowledgeAcrossTopics) tidak membengkak tanpa batas untuk pesan yang
 * menyebut banyak kata kunci sekaligus.
 *
 * --- Kenapa `general`/`greeting` dibuang dari hasil ---
 *
 * Keduanya bukan topik tambahan yang BERMAKNA di gerbang runtime-integration.ts -- `general`
 * sudah baseline (Ruling R30, selalu boleh masuk lewat overlap kata, tidak butuh gerbang), dan
 * `greeting` tidak pernah punya fakta katalog/knowledge sendiri untuk digabung. Membiarkan
 * keduanya lolos hanya membuat `alsoTopics` lebih ramai tanpa menambah satu fakta pun yang
 * bisa dijawab.
 *
 * --- Kenapa kegagalan mengembalikan daftar kosong ---
 *
 * Perilaku fail-open yang sama dengan classifyTopicViaLLM dan classifyFactTopics: sebuah
 * timeout/error/keluaran tak valid pada panggilan KEDUA ini tidak boleh membatalkan seluruh
 * giliran -- topik UTAMA (dari classifyTopicViaLLM, panggilan yang SAMA sekali gagalnya
 * independen) tetap menjawab pesan seperti biasa; hanya topik TAMBAHANnya yang hilang untuk
 * giliran itu, dicatat lewat console.error supaya tidak hilang tanpa jejak.
 */
import { callLLM } from './llm'
import { RESOLVER_TOPICS, type ResolverTopic } from './module-resolver'

const VALID = new Set<string>(RESOLVER_TOPICS)

/** Bukan topik tambahan yang bermakna -- lihat header di atas untuk alasannya. */
const MEANINGLESS_ALSO_TOPICS = new Set<ResolverTopic>(['general', 'greeting'])

/**
 * Plafon jumlah topik yang diterima dari satu pesan. Tujuannya satu: membatasi pertumbuhan
 * prompt -- setiap topik menambah fakta katalog/disclosure yang digabungkan
 * (orchestrator.ts's mergeKnowledgeAcrossTopics), jadi pesan yang menyebut banyak kata kunci
 * tidak boleh membengkakkan prompt tanpa batas.
 *
 * Angka 6 adalah keputusan CONTROLLER (Ruling R103), bukan pilihan operator: operator hanya
 * memilih "panggilan LLM terpisah, diukur dulu di 30 pesan berlabel"; angka 4 sebelumnya berasal
 * dari teks plan controller. Bukti yang mengubahnya: pesan permintaan penawaran produksi
 * (cmsn7yfn) menanyakan 6 topik -- price, inclusions, private_tour, vehicle, payment,
 * cancellation -- dan plafon 4 membuang payment dan cancellation, konsisten 3 dari 3 run.
 * Ukuran prompt pada plafon ini, diukur 2026-09-11 dengan resolveKnowledgeForTopic sungguhan:
 * gabungan terburuk (topik utama + 6 topik tambahan) 4.959 karakter (destinasi Ijen); seluruh
 * topik digabung sekaligus 5.163 karakter.
 */
const MAX_TOPICS = 6

// Disambiguasi "transfer", parafrase "blue flames", dan daftar destinasi destination_readiness
// disalin dari prompt classifier topik UTAMA (topic-classifier.ts, TOPIC_CLASSIFICATION_SYSTEM_PROMPT)
// supaya kedua classifier memisahkan topik dengan aturan yang sama (Ruling R104).
const MULTI_TOPIC_SYSTEM_PROMPT = `You read one customer WhatsApp message to a private tour operator (JVTO) in East Java, Indonesia, and list EVERY topic it genuinely asks about -- not just the main one. Most messages ask about only one thing; some ask about several at once, and every one of those must be listed.

- "inclusions": what is included/excluded in a package.
- "price": cost, pricing, budget, "how much" -- but NOT the deposit or a payment method specifically, which is "payment" instead.
- "private_tour": private vs. shared/group, or the guide/driver arrangement itself.
- "vehicle": vehicle type, capacity, luggage space.
- "rooming": room configuration -- twin/double/single bed, room type.
- "hotel": accommodation/hotel standard, overnight stays.
- "route_endpoint": where the trip starts or finishes, drop-off points, the ferry crossing to/from Bali.
- "destination_readiness": safety, difficulty, or what to prepare for a SPECIFIC destination (Ijen, Bromo, Tumpak Sewu, Madakaripura, Papuma) -- hiking difficulty, what to bring, is it safe.
- "booking": how to book, the reservation process itself.
- "payment": deposit, payment methods, bank transfer, instalments -- how or when money changes hands. A message mentioning "transfer" in a travel sense (an airport/inter-city transfer, not a money transfer) is NOT this topic.
- "cancellation": cancellation, refund, reschedule, travel credit policy.
- "blue_fire": specifically the Blue Fire phenomenon at Ijen (including paraphrases like "blue flames").
- "greeting": a simple greeting with no real question.
- "general": anything that doesn't fit one of the topics above.

List at most 6 topics, in the order they're asked. Reply with ONLY valid JSON, no markdown, no explanation, exactly this shape:
{"topics": ["<topic>", "..."]}

Examples:

Message: "How do I book, and what's the cancellation policy if plans change?"
Output: {"topics": ["booking", "cancellation"]}

Message: "What's included in the tour?"
Output: {"topics": ["inclusions"]}

Message: "How much is the deposit, and can we still see the blue fire this time of year?"
Output: {"topics": ["payment", "blue_fire"]}

Message: "Does the price include the airport transfer?"
Output: {"topics": ["inclusions"]}`

function stripCodeFence(raw: string): string {
  return raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
}

export async function classifyAllTopics(message: string, model?: string): Promise<ResolverTopic[]> {
  try {
    const raw = await callLLM(message, { system: MULTI_TOPIC_SYSTEM_PROMPT, model })
    const parsed: unknown = JSON.parse(stripCodeFence(raw))
    if (typeof parsed !== 'object' || parsed === null) return []
    const topics = (parsed as Record<string, unknown>).topics
    if (!Array.isArray(topics)) return []
    const valid = topics.filter(
      (t): t is ResolverTopic => typeof t === 'string' && VALID.has(t) && !MEANINGLESS_ALSO_TOPICS.has(t as ResolverTopic)
    )
    return [...new Set(valid)].slice(0, MAX_TOPICS)
  } catch (error) {
    // Tidak melempar: lihat komentar kepala berkas -- kegagalan panggilan ini tidak boleh
    // membatalkan giliran, hanya kehilangan topik tambahan, dicatat supaya tidak diam-diam.
    console.error('multi-topic classification failed', { error })
    return []
  }
}
