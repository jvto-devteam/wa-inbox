/**
 * Menandai satu FAKTA dengan topik-topik yang dilayaninya.
 *
 * --- Kenapa ini terpisah dari topic-classifier.ts ---
 *
 * Pertanyaannya berbeda, dan bentuk jawabannya ikut berbeda:
 *
 *   pesan pelanggan : "ini pertanyaan tentang apa?"        -> TEPAT SATU topik
 *   fakta knowledge : "fakta ini melayani topik apa saja?" -> SATU ATAU LEBIH
 *
 * Memaksa fakta ke satu topik akan membuangnya dari sisi yang lain: entri drop-off Malang
 * yang memuat surcharge melayani `route_endpoint` DAN `price`, dan pelanggan yang menulis
 * "how much to drop off in malang?" diklasifikasi ke `price`.
 *
 * --- Kenapa dipanggil saat SIMPAN, bukan saat baca ---
 *
 * Sekali per revisi, bukan sekali per giliran. Runtime tetap deterministik: gerbang di
 * runtime-integration.ts hanya membandingkan dua nilai tersimpan, tidak memanggil model.
 * Memanggil model saat baca akan membuat gerbang tidak bisa ditelusuri -- kenapa entri ini
 * lolos kemarin tapi tidak hari ini?
 *
 * --- Kenapa kegagalan mengembalikan daftar kosong ---
 *
 * Daftar kosong = perilaku sebelum field `topics` ada (overlap token). Itu penurunan mutu
 * yang aman. Melempar akan memblokir operator menulis knowledge karena masalah yang tidak
 * ada hubungannya dengan tulisannya.
 */
import { callLLM } from './llm'
import { RESOLVER_TOPICS, type ResolverTopic } from './module-resolver'

const VALID = new Set<string>(RESOLVER_TOPICS)

const FACT_TOPIC_SYSTEM_PROMPT = `You are tagging one FACT from a private tour operator's (JVTO, East Java, Indonesia) knowledge base.

Decide which of these 14 topics this fact could legitimately help answer. A fact may serve SEVERAL topics — tag every one that genuinely applies, but do not tag topics the fact says nothing about.

- "inclusions": what is included/excluded in a package.
- "price": cost, pricing, budget, "how much".
- "private_tour": private vs shared/group, or the guide/driver arrangement.
- "vehicle": vehicle type, capacity, luggage space.
- "rooming": room configuration — twin/double/single bed, room type.
- "hotel": accommodation/hotel standard, overnight stays.
- "route_endpoint": where the trip starts or finishes, drop-off points, the Bali ferry crossing.
- "destination_readiness": safety, difficulty, or what to prepare for a specific destination.
- "booking": how to book, the reservation process.
- "payment": deposit, payment methods, bank transfer, instalments — how or when money changes hands.
- "cancellation": cancellation, refund, reschedule, travel credit.
- "blue_fire": the Blue Fire phenomenon at Ijen specifically.
- "greeting": a plain greeting with no real question.
- "general": broadly useful facts that do not belong to any single topic above.

Reply with ONLY valid JSON, no markdown, no explanation, exactly this shape:
{"topics": ["<topic>", "..."]}

Examples:

Fact: "Can a Surabaya package finish with drop-off in Malang? — Yes. An additional per-vehicle fee applies; see the current price list."
Output: {"topics": ["route_endpoint", "price"]}

Fact: "How much deposit confirms a booking? — 20% of the total."
Output: {"topics": ["payment", "booking"]}

Fact: "All tours are 100% private — your group only, no strangers ever."
Output: {"topics": ["private_tour", "general"]}`

/** Buang pagar kode kalau model menyertakannya walau diminta tidak. */
function stripCodeFence(raw: string): string {
  return raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
}

export async function classifyFactTopics(
  question: string,
  answer: string,
  model?: string,
): Promise<ResolverTopic[]> {
  try {
    const raw = await callLLM(`${question}\n${answer}`, {
      system: FACT_TOPIC_SYSTEM_PROMPT,
      model,
    })
    const parsed: unknown = JSON.parse(stripCodeFence(raw))
    if (typeof parsed !== 'object' || parsed === null) return []
    const topics = (parsed as Record<string, unknown>).topics
    if (!Array.isArray(topics)) return []
    const valid = topics.filter((t): t is ResolverTopic => typeof t === 'string' && VALID.has(t))
    return [...new Set(valid)]
  } catch (error) {
    // Tidak melempar: lihat komentar kepala berkas -- operator tetap bisa menyimpan. Tapi
    // kegagalannya dicatat, sama seperti classifyTopicViaLLM, supaya tidak hilang tanpa jejak.
    console.error('fact topic classification failed', { error })
    return []
  }
}
