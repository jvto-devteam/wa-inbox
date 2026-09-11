/**
 * Where Bot Control's published configuration actually reaches the bot.
 *
 * Phases C to G built four loaders and wired none of them into the decision path: publishing a
 * rule wrote a row that nothing read. This module is the join, kept as its own file so the
 * change to `orchestrator.ts` — a 1,753-line file whose control flow is the product — stays
 * three small call sites instead of logic spread through it.
 *
 * --- Every function here is safe by omission ---
 *
 * Each one answers "what did the operator publish, if anything" and falls back to what the code
 * did before. A database outage, an un-seeded table, a shape this build cannot read: all of them
 * produce the bot's previous behaviour, never a half-applied configuration. That is the property
 * that makes turning this on at all defensible — the worst case is Phase G's bot, not an
 * unpredictable one.
 */
import { prisma } from '@/lib/db'
import {
  loadPublishedManagedKnowledge,
  type KnowledgeRef,
  type ManagedKnowledge,
  type ManagedKnowledgeEntry,
} from '@/lib/bot/managed-knowledge'
import type { ResolverTopic } from './module-resolver'

/**
 * Whether the LLM escalation layer should run.
 *
 * Only the LLM layer. The explicit keyword gate in `escalation-classifier.ts` runs
 * unconditionally and is not reachable from any form — `rule-registry.ts` says exactly this,
 * and it is the reason this switch can exist at all. A customer who types "saya mau bicara
 * dengan manusia" still reaches a human whatever anyone sets here.
 *
 * Read from `Settings.handoffOnHumanRequest`, edited on /chatbot. It used to come from a
 * published rule row behind a draft/review/approve/publish cycle — for one boolean
 * whose only two states are "run the extra classifier" and "don't".
 *
 * Defaults to TRUE on any failure: this rule is a restriction on the bot, so an unreadable one
 * must leave the restriction in place.
 */
export async function shouldRunEscalationClassifier(): Promise<boolean> {
  return settingsFlag('handoffOnHumanRequest', true)
}

/**
 * One operator-editable sentence from `Settings`, or the caller's own constant.
 *
 * --- Why `Settings` and not a versioned flow table ---
 *
 * These two strings used to live in a versioned flow table, behind a full draft/review/
 * approve/publish/rollback cycle and five API routes — for one row holding two sentences. The
 * branching those tables claimed to configure is `if` statements in `orchestrator.ts`, so the
 * versioning never had a second flow to version. Two nullable columns and the /chatbot page's
 * existing edit-save-live pattern say the same thing without the machinery.
 *
 * --- Empty means "use the code's wording", never "say nothing" ---
 *
 * A blank box is how an operator reverts. Making them retype the original sentence to get back
 * to it is how a typo becomes permanent, so null, "" and whitespace all fall through to
 * `codeDefault`.
 *
 * --- Fail open ---
 *
 * This is read inside a bot turn. A database outage returns the code's own wording, logged: the
 * bot has always run on those constants, and a turn that dies because a CONFIGURATION lookup
 * failed is a far worse outcome than one running on last week's wording.
 *
 * Deliberately uncached, unlike the rule and knowledge loaders. It is one indexed lookup of a
 * single row on a path that already does several, and the /chatbot page promises "save and it
 * is live" — a 30-second cache would make an operator press Simpan twice.
 */
async function settingsText(field: 'fallbackReply' | 'handoffReply', codeDefault: string): Promise<string> {
  try {
    const row = await prisma.settings.findUnique({
      where: { id: 1 },
      select: { fallbackReply: true, handoffReply: true },
    })
    const value = row?.[field]
    return typeof value === 'string' && value.trim().length > 0 ? value : codeDefault
  } catch (error) {
    console.error('runtime-integration: gagal membaca Settings, memakai kalimat bawaan kode', { field, error })
    return codeDefault
  }
}

/**
 * One operator-editable boolean from `Settings`, or the code's own default.
 *
 * Same shape and the same fail-open contract as `settingsText` above, and here for the same
 * reason: this is read inside a bot turn, so a database outage has to produce the behaviour the
 * bot had before anyone configured anything — never an exception that kills the turn, and never
 * the opposite of what the operator set.
 */
async function settingsFlag(field: 'handoffOnHumanRequest', codeDefault: boolean): Promise<boolean> {
  try {
    const row = await prisma.settings.findUnique({
      where: { id: 1 },
      select: { handoffOnHumanRequest: true },
    })
    const value = row?.[field]
    return typeof value === 'boolean' ? value : codeDefault
  } catch (error) {
    console.error('runtime-integration: gagal membaca Settings, memakai default kode', { field, error })
    return codeDefault
  }
}

/** The operator's fallback wording, or the caller's own constant. */
export async function fallbackReplyText(codeDefault: string): Promise<string> {
  return settingsText('fallbackReply', codeDefault)
}

/**
 * The operator's handoff wording, or the caller's own constant.
 *
 * Replaces `clarificationText`, which was exported here with a docstring and never called by
 * anything: clarify replies are composed per branch, so there was no single sentence to
 * override. `handoffReply` does have one — inbound.ts says the same fixed sentence on every
 * handoff — so this is the one that can honestly exist.
 */
export async function handoffReplyText(codeDefault: string): Promise<string> {
  return settingsText('handoffReply', codeDefault)
}

export type ManagedFacts = {
  /** Lines to fold into the grounding, in the same shape the catalog produces. */
  lines: string[]
  /**
   * Parallel to `lines`: the "Title (vN)" source string each line in `lines` came from.
   * Optional (and absent on the `EMPTY` shortcut) so the pre-Task-17 exact-shape tests below
   * keep passing unmodified -- `toEqual` treats an absent key the same as one set to
   * `undefined`. Populated whenever `lines` is built by `collect()`, which is every non-EMPTY
   * result. Task 17: feeds `DecisionKnowledge.managedLines` in orchestrator.ts.
   */
  lineSources?: string[]
  /** Trace refs, labelled MANAGED so a reader can tell them from catalog facts. */
  refs: KnowledgeRef[]
  /**
   * True kalau gerbang topik menghasilkan NOL baris lalu diulang tanpa gerbang.
   *
   * Ini gejala klasifikasi meleset, bukan kondisi normal. Dicatat di trace supaya
   * frekuensinya bisa dihitung -- kalau sering, gerbangnya lebih merugikan daripada
   * menolong dan harus ditinjau ulang.
   */
  gateBypassed: boolean
  /**
   * Berapa item yang lolos gerbang/overlap tetapi dipotong oleh `MAX_MANAGED_ITEMS_PER_TURN`
   * (Ruling R63). BUKAN "ditolak gerbang" -- item ini sudah lolos, hanya kalah peringkat saat
   * plafon penuh. Dicatat terpisah supaya trace bisa membedakan dua kondisi yang beda arti:
   * gerbang topik yang menolak (irelevan) vs. plafon yang memotong (relevan tapi kebanyakan).
   */
  truncated: number
  /**
   * Entri yang DITOLAK gerbang topik pada giliran ini, beserta alasannya (Ruling R54).
   *
   * Gerbang yang tidak bisa diperiksa adalah gerbang yang harus dipercaya. Ini yang membuat
   * "kenapa fakta ini tidak ikut?" bisa dijawab tanpa menjalankan ulang giliran itu -- dan
   * langsung menyerang risiko terbesar perubahan ini: klasifikasi meleset membuang fakta benar.
   *
   * Dibatasi dengan sengaja, BUKAN "semua entri yang topiknya tidak cocok": hanya entri yang
   * DITOLAK gerbang TETAPI lolos overlap kata (akan masuk kalau gerbang tidak ada). Entri tanpa
   * satu kata pun yang sama dengan pesan tidak akan ikut dengan atau tanpa gerbang, jadi
   * gerbang bukan alasannya -- tidak dicatat. Entri yang kemudian dimasukkan kembali oleh
   * jaring R41 juga tidak dicatat di sini (lihat `gateBypassed`) -- tapi "dimasukkan kembali"
   * BUKAN berarti "pasti terjawab": jaring memanggil `collect` yang sama, jadi kandidatnya
   * tunduk pada plafon `MAX_MANAGED_ITEMS_PER_TURN` milik `collect` juga (Ruling R63). Kalau
   * kandidat jaring melebihi plafon itu, kelebihannya terhitung di `truncated` -- BUKAN di sini,
   * dan BUKAN "ditolak gerbang" (Ruling R54: potongan plafon != penolakan gerbang). Field ini
   * murni tentang gerbang TOPIK; nasib akhir sebuah entri di jalur jaring (terjawab vs. terpotong
   * plafon) ada di `truncated`/`lines`, bukan di sini.
   */
  rejected: Array<{ sourceKey: string; itemQuestion: string; reason: string }>
  /**
   * Berapa entri `rejected` yang DIBUANG oleh plafon `MAX_REJECTED_RECORDED` (Ruling R83) --
   * BUKAN entri yang tidak pernah masuk `rejected` sama sekali (lihat header field itu untuk
   * yang sengaja dikecualikan). 0 kalau jumlah entri yang lolos ke `rejected` tidak pernah
   * melebihi plafon, termasuk pada jalur jaring (Ruling R41) yang mengosongkan `rejected`
   * sepenuhnya -- tidak ada yang "dibuang" dari daftar yang memang kosong.
   */
  rejectedOmitted: number
  /**
   * True kalau pembacaan knowledge terkelola GAGAL (loader melempar, atau mengembalikan
   * `available: false`) -- BUKAN kondisi "memang tidak ada knowledge yang diterbitkan"
   * (Ruling R46). Sebelum Fase 2 knowledge cuma pelengkap, jadi kedua kondisi itu sama-sama
   * aman ditelan sebagai "tidak ada fakta tambahan". Sesudahnya knowledge memegang seluruh
   * fakta bisnis JVTO, jadi caller (orchestrator.ts, dua titik) WAJIB memeriksa field ini
   * sebelum menyusun prompt apa pun -- kalau true, jawab clarify (TECHNICAL_HICCUP_REPLY),
   * jangan diam-diam menjawab dari separuh pengetahuan.
   */
  degraded: boolean
}

const EMPTY: ManagedFacts = {
  lines: [],
  refs: [],
  gateBypassed: false,
  truncated: 0,
  rejected: [],
  rejectedOmitted: 0,
  degraded: false,
}

/**
 * Words too common to carry a topic.
 *
 * The question words matter most and are the reason this list is as long as it is: "berapa"
 * appears in a large share of every Indonesian customer message this bot sees, so leaving it in
 * made a single FAQ about ATV prices match "jam berapa pickup dari bandara?" — and from there,
 * every entry would match nearly every message. Politeness fillers are here for the same reason.
 */
const STOPWORDS = new Set([
  // Question words and fillers, Indonesian.
  'yang', 'untuk', 'dari', 'dengan', 'atau', 'dan', 'ada', 'apa', 'apakah', 'adakah', 'bisa',
  'bisakah', 'boleh', 'saya', 'kami', 'kita', 'anda', 'ini', 'itu', 'berapa', 'kapan', 'dimana',
  'mana', 'bagaimana', 'gimana', 'kenapa', 'mengapa', 'siapa', 'mohon', 'tolong', 'terima',
  'kasih', 'selamat', 'halo', 'hallo', 'sudah', 'belum', 'akan', 'juga', 'saja', 'kalau', 'jika',
  'tapi', 'tetapi', 'karena', 'tersebut', 'tentang', 'seperti', 'punya', 'ingin', 'pengen',
  // English.
  'the', 'and', 'for', 'with', 'you', 'are', 'what', 'can', 'how', 'where', 'when', 'does',
  'have', 'this', 'that', 'there', 'would', 'could', 'should', 'please', 'thanks', 'hello',
  'about', 'from', 'your', 'much', 'many',
])

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length >= 4 && !STOPWORDS.has(word))
  )
}

/**
 * Plafon item knowledge terkelola per giliran (Ruling R63), dihitung dalam ITEM -- satu item
 * bisa menghasilkan beberapa BARIS (harga dan tautan berdiri sendiri, lihat `collect` di
 * bawah), jadi menghitung baris akan memotong entri yang punya banyak harga lebih agresif
 * daripada entri yang cuma punya satu jawaban teks, tanpa alasan.
 *
 * Angka 8 dipilih dari seed FAQ Task 11: paling banyak ~5 item per topik (blok GENERAL + 4
 * blok destination_readiness), jadi plafon ini TIDAK memangkas apa pun pada data hari ini --
 * ia pengaman untuk pertumbuhan data ke depan. Setiap kali plafon benar-benar memotong, itu
 * terlihat di trace ('Knowledge terkelola dipangkas'), jadi angkanya bisa ditinjau ulang
 * dengan data pemakaian nyata (Task 16) alih-alih ditebak dua kali.
 */
export const MAX_MANAGED_ITEMS_PER_TURN = 8

/**
 * Plafon berapa entri `ManagedFacts.rejected` yang benar-benar DICATAT per giliran (Ruling
 * R83), terpisah total dari `MAX_MANAGED_ITEMS_PER_TURN` di atas -- yang itu membatasi apa yang
 * DIJAWAB, ini membatasi apa yang DICATAT sebagai "ditolak beserta alasannya".
 *
 * Kenapa perlu plafon sendiri: review menyeluruh menemukan giliran nyata dengan 150 dari 150
 * entri topik-lain beririsan kata tercatat di `rejected` sekaligus -- dan entri ini disimpan TIGA
 * kali per giliran (`BotDecisionRun.trace`, `BotDecisionRun.knowledgeRefs`, `Message.botTrace`),
 * jadi 150 entri jadi ~450 salinan JSON tanpa retensi apa pun. Angka 20 dipilih supaya trace
 * tetap bisa menjawab "kenapa fakta ini tidak ikut?" untuk kasus nyata (data hari ini jauh di
 * bawah 20) tanpa ikut menyimpan setiap entri topik-lain yang kebetulan berbagi satu kata dengan
 * pesan pelanggan. Entri yang dibuang oleh plafon ini TETAP dihitung lewat `rejectedOmitted`,
 * bukan hilang tanpa jejak -- hanya isinya (sourceKey/pertanyaan/alasan) yang tidak lagi
 * tersimpan di luar 20 entri pertama, dalam urutan asli.
 */
export const MAX_REJECTED_RECORDED = 20

/** Hasil evaluasi satu item terhadap giliran ini -- lolos lewat topik, lewat overlap, atau tidak sama sekali. */
type ItemMatch = {
  admitted: boolean
  /** True kalau lolos di Lapis 1 (topik spesifik cocok) atau baseline `general` -- bukan lewat overlap kata. */
  admittedByTopic: boolean
  /** Jumlah kata bermakna pada pertanyaan/tag item yang juga ada di pesan pelanggan. */
  overlapScore: number
  /**
   * True HANYA kalau item ini ditolak MURNI oleh gerbang topik (Lapis 1, topik spesifik) padahal
   * overlap katanya > 0 -- yaitu item yang AKAN masuk lewat overlap kata (Lapis 2) seandainya
   * gerbang topik tidak ada. Dipakai `collect` untuk mengisi `ManagedFacts.rejected` (Ruling
   * R54); lihat header field itu untuk kenapa batasnya sesempit ini.
   */
  gateRejectedWithOverlap: boolean
}

/**
 * Mengevaluasi satu item terhadap giliran ini. Logikanya sama persis dengan sebelum Ruling
 * R63 -- hanya diekstrak dari `.filter()` supaya `collect` bisa tahu BAGAIMANA item itu lolos
 * (topik vs overlap) dan APA skor overlap-nya, keduanya dipakai untuk memeringkat kandidat
 * saat plafon `MAX_MANAGED_ITEMS_PER_TURN` terlampaui.
 */
function evaluateItem(
  item: ManagedKnowledgeEntry['items'][number],
  asked: Set<string>,
  topic: ResolverTopic | null
): ItemMatch {
  const specificTopic = topic !== null && topic !== 'general'
  const candidate = tokens(`${item.question} ${(item.tags ?? []).join(' ')}`)
  let overlapScore = 0
  for (const word of candidate) if (asked.has(word)) overlapScore += 1

  // Lapis 1 -- gerbang topik untuk topik SPESIFIK. `topics` terisi berarti operator (atau
  // classifier) sudah menyatakan pertanyaan macam apa yang layak dijawab entri ini: kalau
  // topik giliran ini spesifik dan tidak ada di sana, entri itu keluar, berapa pun katanya
  // cocok -- dan sebaliknya, topik yang cocok sudah CUKUP untuk masuk, overlap kata TIDAK
  // lagi disyaratkan (Ruling R56). Sebelum ruling ini, overlap tetap wajib untuk setiap
  // entri walau topiknya sudah cocok -- itu membuang parafrasa persis yang gerbang topik
  // dimaksudkan untuk menangani ("how much do I pay upfront?" vs entri "Berapa deposit?").
  //
  // `topics` KOSONG jatuh ke perilaku sebelum field ini ada (baris Lapis 2 di bawah). Itu
  // yang membuat migrasi bisa bertahap dan nol revisi lama rusak.
  if (specificTopic && item.topics?.length) {
    const admitted = item.topics.includes(topic)
    return {
      admitted,
      admittedByTopic: admitted,
      overlapScore,
      gateRejectedWithOverlap: !admitted && overlapScore > 0,
    }
  }

  // Ruling R30 (keputusan operator setelah Gerbang G1, 2026-09-10): giliran tanpa topik
  // spesifik — `general` atau `null` — TIDAK digerbang berdasar topik semata. Pengukuran
  // Fase 0: 47% lalu lintas memang `general` (pesan tanpa pertanyaan), dan 4 dari 6
  // salah-klasifikasi melibatkan `general`. Entri bertopik `general` adalah baseline yang
  // dikelola operator, jadi topik yang cocok sudah cukup untuk masuk di sini juga; entri
  // lain pada giliran `general` -- dan SEMUA entri pada giliran `null` -- masih harus lewat
  // overlap kata di Lapis 2, sama seperti sebelum gerbang topik ada.
  if (topic === 'general' && item.topics?.includes('general')) {
    return { admitted: true, admittedByTopic: true, overlapScore, gateRejectedWithOverlap: false }
  }

  // Lapis 2 -- overlap token. Jalur ini dipakai kalau topik giliran tidak bisa memutuskan
  // entri ini sendirian: giliran `null` (jaring R41 dan pemanggil tanpa topik), entri tanpa
  // `topics` sama sekali, atau giliran `general` dengan entri yang topiknya bukan
  // `general`. Di sinilah -- dan HANYA di sinilah -- overlap kata tetap jadi syarat masuk.
  return { admitted: overlapScore > 0, admittedByTopic: false, overlapScore, gateRejectedWithOverlap: false }
}

/**
 * The matching core of `managedFactsFor`, factored out so it can be called twice in one turn:
 * once gated by topic, and -- only when that yields nothing and the catalog itself has no
 * answer either (Ruling R41) -- once more with `topic` forced to `null` to skip the gate.
 *
 * The match itself is deliberately crude: a shared word of four letters or more between the
 * customer's message and the entry's question or tags. Something more clever (embeddings, an
 * LLM judge) would be another model call inside a turn that already spends its budget on
 * several, and would fail in ways nobody could read from a trace.
 *
 * Ruling R63: kandidat dikumpulkan lintas SEMUA entri lebih dulu (bukan per entri), diberi
 * peringkat, lalu dipilih paling banyak `MAX_MANAGED_ITEMS_PER_TURN`. Peringkat: (1) item yang
 * masuk karena topik mengalahkan item yang masuk lewat overlap kata; (2) dalam tiap kelompok,
 * skor overlap menurun; (3) seri diputus oleh urutan asli (entri, lalu item) supaya hasilnya
 * deterministik. Item terpilih lalu DIKELUARKAN dalam urutan ASLI entri/item -- bukan urutan
 * peringkat -- supaya prompt tetap terbaca per sumber, sama seperti sebelum plafon ini ada.
 */
function collect(
  managed: ManagedKnowledge,
  asked: Set<string>,
  topic: ResolverTopic | null
): {
  lines: string[]
  lineSources: string[]
  refs: KnowledgeRef[]
  truncated: number
  rejected: Array<{ sourceKey: string; itemQuestion: string; reason: string }>
  rejectedOmitted: number
} {
  type Candidate = {
    entryIndex: number
    itemIndex: number
    admittedByTopic: boolean
    overlapScore: number
  }

  const candidates: Candidate[] = []
  // Ruling R54: setiap item yang ditolak MURNI oleh gerbang topik padahal overlap katanya > 0
  // dicatat di sini, terpisah dari `candidates` -- item yang tidak lolos sama sekali tidak
  // pernah masuk seleksi/plafon di bawah, jadi daftar ini tidak kena peringkat atau
  // MAX_MANAGED_ITEMS_PER_TURN. Saat `topic` adalah `null` (giliran jaring R41), Lapis 1 tidak
  // pernah berjalan (lihat evaluateItem), jadi daftar ini otomatis selalu kosong untuk panggilan
  // itu -- properti yang membuat managedFactsFor bisa langsung memakainya di bawah.
  const rejected: Array<{ sourceKey: string; itemQuestion: string; reason: string }> = []
  managed.entries.forEach((entry, entryIndex) => {
    entry.items.forEach((item, itemIndex) => {
      const result = evaluateItem(item, asked, topic)
      if (result.admitted) {
        candidates.push({ entryIndex, itemIndex, admittedByTopic: result.admittedByTopic, overlapScore: result.overlapScore })
      } else if (result.gateRejectedWithOverlap) {
        rejected.push({
          sourceKey: entry.sourceKey,
          itemQuestion: item.question,
          reason: `topik [${(item.topics ?? []).join(', ')}] tidak memuat ${topic}`,
        })
      }
    })
  })

  const ranked = [...candidates].sort((a, b) => {
    if (a.admittedByTopic !== b.admittedByTopic) return a.admittedByTopic ? -1 : 1
    if (a.overlapScore !== b.overlapScore) return b.overlapScore - a.overlapScore
    if (a.entryIndex !== b.entryIndex) return a.entryIndex - b.entryIndex
    return a.itemIndex - b.itemIndex
  })

  const selected = ranked.slice(0, MAX_MANAGED_ITEMS_PER_TURN)
  const truncated = candidates.length - selected.length

  const selectedItemsByEntry = new Map<number, Set<number>>()
  for (const candidate of selected) {
    const itemIndices = selectedItemsByEntry.get(candidate.entryIndex) ?? new Set<number>()
    itemIndices.add(candidate.itemIndex)
    selectedItemsByEntry.set(candidate.entryIndex, itemIndices)
  }

  const lines: string[] = []
  // Parallel to `lines` -- each line's "Title (vN)" source string (Task 17, feeds
  // `ManagedFacts.lineSources` / `DecisionKnowledge.managedLines`).
  const lineSources: string[] = []
  const refs: KnowledgeRef[] = []

  managed.entries.forEach((entry, entryIndex) => {
    const itemIndices = selectedItemsByEntry.get(entryIndex)
    if (!itemIndices || itemIndices.size === 0) return

    const source = `${entry.sourceTitle} (v${entry.version})`

    entry.items.forEach((item, itemIndex) => {
      if (!itemIndices.has(itemIndex)) return

      lines.push(`${item.question} — ${item.answer}`)
      lineSources.push(source)
      // Prices and links travel as their own lines so the reply verifier can source them: a
      // figure buried in prose is indistinguishable, to it, from one the model invented.
      for (const price of item.prices ?? []) {
        lines.push(`${price.label}: ${price.currency} ${price.amount}${price.note ? ` (${price.note})` : ''}`)
        lineSources.push(source)
      }
      for (const link of item.links ?? []) {
        lines.push(`${link.label}: ${link.url}`)
        lineSources.push(source)
      }
    })

    refs.push({
      sourceType: 'MANAGED',
      sourceKey: entry.sourceKey,
      title: entry.sourceTitle,
      version: entry.version,
    })
  })

  // Ruling R83: `rejected` above accumulates EVERY gate-rejected-with-overlap item in original
  // order, unbounded -- a real turn measured 150 of them, stored three times over
  // (BotDecisionRun.trace/knowledgeRefs, Message.botTrace). Capped here, once, at the single
  // place `rejected` is built, so every caller of `collect` gets the same bounded shape; the
  // excess count travels as `rejectedOmitted` rather than vanishing silently.
  const rejectedRecorded = rejected.slice(0, MAX_REJECTED_RECORDED)
  const rejectedOmitted = Math.max(0, rejected.length - MAX_REJECTED_RECORDED)

  return { lines, lineSources, refs, truncated, rejected: rejectedRecorded, rejectedOmitted }
}

/**
 * Managed knowledge relevant to one customer message.
 *
 * Matched rather than dumped. Folding EVERY published entry into every prompt would bury the
 * catalog facts the answer actually needs under unrelated ones, and the reply verifier would
 * then have more sourceable prices and URLs than the question ever called for — which is the
 * opposite of what `bot.no_invented_price` is protecting.
 *
 * Ruling R41 -- the safety net only runs when the catalog has no facts. When the topic gate
 * (see `collect`) discards every entry, that can mean two different things: the topic really
 * has nothing to add (fine), or the topic classifier guessed wrong and just threw away a real
 * answer (not fine). This function cannot tell those apart, so it resolves the ambiguity with
 * `hasCatalogFacts`, which the caller computes from what it already resolved BEFORE calling
 * here: if the catalog already has an answer for this turn, one is not missing, so retrying
 * ungated would only readmit the exact cross-topic entry the gate just rejected -- the opposite
 * of the gate's purpose (Task 5) and enough to fail Task 5's own rejection test if it ran on
 * every turn. Only when the catalog is ALSO silent does a rough, ungated answer beat none at
 * all -- and even then, it is marked `gateBypassed: true` so how often this fires can be
 * counted, not hidden.
 */
export async function managedFactsFor(
  message: string,
  topic: ResolverTopic | null,
  hasCatalogFacts = false
): Promise<ManagedFacts> {
  let managed
  try {
    managed = await loadPublishedManagedKnowledge()
  } catch (error) {
    // The loader already fails open; this is belt-and-braces because the caller is a bot turn.
    // Ruling R46: a thrown loader IS a read failure, so this is `degraded: true`, not the plain
    // EMPTY a caller could mistake for "nothing published".
    console.error('managedFactsFor: gagal memuat knowledge terkelola', { error })
    return { ...EMPTY, degraded: true }
  }

  // Ruling R46: checked BEFORE `entries.length === 0` below on purpose. The loader returns the
  // exact same `entries: []` shape on a failed read as it does when nothing is published
  // (managed-knowledge.ts:97, :143) -- checking `available` only after that early return would
  // let a read failure hide inside "no knowledge", the very bug this ruling exists to close.
  if (managed.available === false) return { ...EMPTY, degraded: true }
  if (managed.entries.length === 0) return EMPTY

  // Ruling R56: `asked.size === 0` dulu jadi early return di sini, sebelum `collect` sempat
  // jalan sama sekali -- pesan yang cuma berisi stopword (mis. "berapa?") jadi selalu kosong
  // walau topik giliran itu cocok dengan sebuah entri. Topik yang cocok tidak butuh overlap
  // kata sama sekali (lihat Lapis 1 di `collect`), jadi early return itu hanya boleh berlaku
  // untuk entri yang memang bergantung pada overlap -- dan `collect` sendiri sudah menolak
  // entri semacam itu wajar-wajar saja saat `asked` kosong, tanpa perlu jalan pintas di sini.
  const asked = tokens(message)

  const gated = collect(managed, asked, topic)
  if (gated.lines.length > 0) return { ...gated, gateBypassed: false, degraded: false }

  // Gerbang menghasilkan nol baris. Jaring (retry tanpa gerbang) HANYA berjalan kalau giliran
  // ini memang belum punya jawaban dari katalog (Ruling R41) -- kalau katalog sudah menjawab,
  // mengulang di sini hanya memasukkan kembali entri lintas-topik yang baru saja ditolak
  // gerbang, kebalikan dari tujuan gerbang itu sendiri.
  if (hasCatalogFacts) return { ...gated, gateBypassed: false, degraded: false }

  // Ini bisa berarti dua hal: memang tidak ada fakta yang relevan (wajar), atau klasifikasi
  // meleset dan fakta yang benar baru saja dibuang (tidak wajar). Kita tidak bisa
  // membedakannya di sini, jadi kita pilih sisi yang lebih murah salahnya -- jawab dengan
  // bahan seadanya, lalu tandai supaya bisa dihitung.
  const ungated = collect(managed, asked, null)
  const bypassed = ungated.lines.length > 0
  // Ruling R54: setiap item di `gated.rejected` punya overlapScore > 0 by construction (lihat
  // gateRejectedWithOverlap), dan admisi Lapis 2 di sini (`topic: null`) adalah PERSIS
  // `overlapScore > 0` -- jadi setiap item di `gated.rejected` MENJADI KANDIDAT jaring ini, bukan
  // otomatis terjawab: `collect` di atas juga menegakkan `MAX_MANAGED_ITEMS_PER_TURN` miliknya
  // sendiri (Ruling R63), jadi kalau kandidat jaring melebihi plafon itu, kelebihannya terpotong
  // dan terhitung di `ungated.truncated` -- BUKAN "ditolak gerbang" (Ruling R54: potongan plafon
  // != penolakan gerbang). `rejected` tetap dikosongkan begitu jaring menghasilkan sesuatu
  // (`bypassed`) karena field ini murni menjawab "gerbang topik menolak apa" -- nasib akhir
  // sebuah item di jalur jaring (terjawab vs. terpotong plafon) sudah pindah ke
  // `truncated`/`lines`, bukan lagi cerita gerbang.
  return {
    ...ungated,
    rejected: bypassed ? [] : gated.rejected,
    // Mirrors `rejected` above: cleared alongside it when the net answers something (nothing
    // left to report as "omitted from a list that is now empty"), otherwise the gate's own
    // omitted count travels with its own (still-reported) rejected list.
    rejectedOmitted: bypassed ? 0 : gated.rejectedOmitted,
    gateBypassed: bypassed,
    degraded: false,
  }
}

/**
 * SELURUH fakta managed yang SUDAH TERBIT -- tanpa gerbang topik, tanpa saringan overlap kata,
 * dan tanpa plafon `MAX_MANAGED_ITEMS_PER_TURN`.
 *
 * Fix round 2 (R100), Important 1: baris di atas sengaja dipertegas dengan "SUDAH TERBIT" --
 * versi sebelumnya menjanjikan pelanggan booking "tetap menerima SELURUH fakta umum yang dulu
 * diterimanya", seolah itu jaminan tanpa syarat. Itu salah: fungsi ini mengembalikan HANYA yang
 * PUBLISHED. Nol entri terbit (keadaan produksi hari ini, sebelum Gerbang G5 menerbitkan
 * `FAQ_SEED_DATA`) berarti fungsi ini mengembalikan `lines: []` -- Mode 3 genuinely menerima NOL
 * fakta umum pada giliran itu, bukan sesuatu yang "seluruhnya" tersampaikan. Yang tetap benar
 * adalah PERILAKU yang dulu dijaga konstanta `GENERAL_FAQ_FALLBACK` (knowledge.ts, dihapus Task
 * 11): kalau ADA yang terbit, semuanya ikut tanpa gerbang topik apa pun (Mode 3 berjalan SEBELUM
 * klasifikasi topik -- lihat orchestrator.ts's header, langkah 1 -- sehingga tidak pernah punya
 * `ResolverTopic` untuk digerbangkan, beda dari `managedFactsFor` yang butuh satu). Bot tetap
 * tidak pernah handoff karena kekosongan ini -- lihat orchestrator.ts's header -- tapi itu
 * jaminan PERILAKU (jangan handoff), bukan jaminan bahwa fakta itu SELALU ada di prompt.
 *
 * Isi baris dan `refs` memakai format yang SAMA dengan `managedFactsFor`'s `collect` (termasuk
 * baris harga dan tautan yang berdiri sendiri, supaya reply-verifier bisa menyumbernya) --
 * hanya tanpa `evaluateItem`/peringkat/plafon: setiap item dari setiap entri terbit langsung
 * masuk, dalam urutan entri/item asli.
 *
 * `gateBypassed`, `rejected`, dan `rejectedOmitted` selalu berisi nilai kosongnya -- tidak ada
 * gerbang di sini untuk dilewati atau menolak apa pun, jadi ketiganya tidak punya cerita untuk
 * diceritakan. `degraded` tetap berarti persis seperti pada `managedFactsFor` (Ruling R46):
 * true HANYA saat pembacaan gagal, bukan saat memang tidak ada yang terbit -- caller (Mode 3 di
 * orchestrator.ts) WAJIB memeriksanya sebelum menyusun prompt, sama seperti kedua titik
 * pemanggil `managedFactsFor` yang sudah ada.
 */
export async function allManagedFacts(): Promise<ManagedFacts> {
  let managed
  try {
    managed = await loadPublishedManagedKnowledge()
  } catch (error) {
    console.error('allManagedFacts: gagal memuat knowledge terkelola', { error })
    return { ...EMPTY, degraded: true }
  }

  // Ruling R46: sama seperti managedFactsFor -- diperiksa SEBELUM `entries.length === 0` di
  // bawah, supaya kegagalan baca (yang mengembalikan bentuk `entries: []` yang SAMA dengan
  // "memang belum ada yang terbit") tidak bersembunyi di baris berikutnya.
  if (managed.available === false) return { ...EMPTY, degraded: true }
  if (managed.entries.length === 0) return EMPTY

  const lines: string[] = []
  const lineSources: string[] = []
  const refs: KnowledgeRef[] = []

  for (const entry of managed.entries) {
    if (entry.items.length === 0) continue
    const source = `${entry.sourceTitle} (v${entry.version})`

    for (const item of entry.items) {
      lines.push(`${item.question} — ${item.answer}`)
      lineSources.push(source)
      // Same reasoning as `collect`: a price or link buried in prose is indistinguishable, to
      // the reply verifier, from one the model invented.
      for (const price of item.prices ?? []) {
        lines.push(`${price.label}: ${price.currency} ${price.amount}${price.note ? ` (${price.note})` : ''}`)
        lineSources.push(source)
      }
      for (const link of item.links ?? []) {
        lines.push(`${link.label}: ${link.url}`)
        lineSources.push(source)
      }
    }

    refs.push({ sourceType: 'MANAGED', sourceKey: entry.sourceKey, title: entry.sourceTitle, version: entry.version })
  }

  return { lines, lineSources, refs, gateBypassed: false, truncated: 0, rejected: [], rejectedOmitted: 0, degraded: false }
}

/**
 * The timezone every working-hours comparison is made in.
 *
 * Hardcoded, and deliberately not `Intl.DateTimeFormat().resolvedOptions().timeZone`: the
 * operator sets "08:00" meaning eight in the morning where the team actually is, and the
 * server this runs on is a VPS whose clock is UTC. Reading the process timezone would make the
 * same saved window mean something different after a redeploy or a host move — a silent,
 * invisible seven-hour shift.
 *
 * JVTO is a single-tenant Java-based operator (see CLAUDE.md), so there is exactly one
 * business timezone and it is WIB. The repo had no existing timezone constant to follow — only
 * `toLocaleString('id-ID')` calls, which are browser-side display formatting and pick up the
 * VIEWER's zone, not the business's — so this is the first one, and it belongs here rather
 * than in a shared module until something outside this feature needs it.
 */
const OPERATING_TIME_ZONE = 'Asia/Jakarta'

/** "HH:MM" on a 24-hour clock, which is exactly what an `<input type="time">` produces. */
const TIME_OF_DAY = /^([01]\d|2[0-3]):([0-5]\d)$/

/** Minutes since midnight for an "HH:MM" string, or null for anything unusable. */
function minutesOfDay(value: string | null | undefined): number | null {
  if (typeof value !== 'string') return null
  const match = TIME_OF_DAY.exec(value.trim())
  if (!match) return null
  return Number(match[1]) * 60 + Number(match[2])
}

/**
 * Built once with an explicit `timeZone`, so it answers the same wherever the process runs and
 * whatever `TZ` is set to — including changed after this module was loaded.
 */
const OPERATING_CLOCK = new Intl.DateTimeFormat('en-GB', {
  timeZone: OPERATING_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

/** Minutes since midnight of `now`, read on the operating timezone's clock. */
function minutesOfDayInOperatingZone(now: Date): number | null {
  const parts = OPERATING_CLOCK.formatToParts(now)
  const hour = Number(parts.find((part) => part.type === 'hour')?.value)
  const minute = Number(parts.find((part) => part.type === 'minute')?.value)
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null
  return hour * 60 + minute
}

/**
 * Whether `now` falls outside the operator's working-hours window.
 *
 * Returns FALSE — "treat this as inside working hours", i.e. say nothing extra — for every
 * window it cannot read: either bound missing, blank, or not "HH:MM", and also a zero-length
 * window (start === end) which is far more likely a half-filled form than a genuine request for
 * "closed 24 hours a day". A configuration nobody can parse must not start appending sentences
 * to customer messages.
 *
 * A window whose end is before its start wraps midnight (22:00–06:00 is a real night shift),
 * so the comparison is an OR rather than an AND in that case. The end bound is exclusive: with
 * 09:00–17:00, 17:00 sharp is already outside, which is how a human reads "sampai jam 5".
 */
function isOutsideWorkingHours(start: string | null, end: string | null, now: Date): boolean {
  const opensAt = minutesOfDay(start)
  const closesAt = minutesOfDay(end)
  if (opensAt === null || closesAt === null || opensAt === closesAt) return false

  const current = minutesOfDayInOperatingZone(now)
  if (current === null) return false

  const inside =
    opensAt < closesAt
      ? current >= opensAt && current < closesAt
      : current >= opensAt || current < closesAt
  return !inside
}

/**
 * The one extra sentence a handoff carries when it happens outside working hours, or null.
 *
 * --- What this is NOT ---
 *
 * It is not an off-hours autoresponder and it does not stop the bot answering. The bot replies
 * 24/7 through the LLM and that is the point of it; swapping a real answer for "we are closed"
 * at 2am would be a WORSE service, not a safer one. This sentence is appended only on the
 * handoff branch in `inbound.ts` — the one case where the bot has just told a customer a human
 * will follow up, and no human is going to see the message for another seven hours. Without
 * it, that promise is silence.
 *
 * --- Empty means off, as everywhere else in this file ---
 *
 * A blank `offHoursAutoReply` appends nothing, matching `fallbackReply`/`handoffReply` above:
 * clearing the box is how an operator turns something off. Unlike those two there is no code
 * default to fall back to, because there is no sentence the code could honestly invent — only
 * the operator knows when their team is back.
 *
 * --- Fail open, and open here means silent ---
 *
 * Every failure path returns null: unreadable Settings, an unparseable window, a missing row.
 * The handoff itself must survive a database hiccup, and an extra sentence is the part of it
 * that is safe to lose.
 */
export async function offHoursHandoffNotice(now: Date = new Date()): Promise<string | null> {
  try {
    const row = await prisma.settings.findUnique({
      where: { id: 1 },
      select: { workingHoursStart: true, workingHoursEnd: true, offHoursAutoReply: true },
    })
    const notice = typeof row?.offHoursAutoReply === 'string' ? row.offHoursAutoReply.trim() : ''
    if (notice.length === 0) return null

    return isOutsideWorkingHours(row?.workingHoursStart ?? null, row?.workingHoursEnd ?? null, now)
      ? notice
      : null
  } catch (error) {
    console.error('runtime-integration: gagal membaca jam kerja dari Settings, handoff tanpa catatan jam', { error })
    return null
  }
}
