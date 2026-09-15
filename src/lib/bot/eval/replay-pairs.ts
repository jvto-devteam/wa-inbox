/**
 * Pasangan "pertanyaan pembuka pelanggan -> jawaban admin JVTO" dari percakapan produksi, untuk
 * direplay ke bot oleh scripts/replay-agent-answers.ts. Jawaban admin adalah sumber kebenaran;
 * selisih jawaban bot terhadapnya menunjukkan celah knowledge atau alur.
 *
 * Murni, kecuali `sweepReplayRows` yang menerima client-nya sebagai parameter: aturan pemilihan
 * pasangan bisa diuji tanpa database produksi dan tanpa LLM.
 *
 * Hanya pesan PEMBUKA. Giliran pertama tidak punya riwayat, jadi replay di percakapan kosong setara
 * dengan yang dilihat bot di produksi. Giliran berikutnya butuh riwayat dan tripBrief pada saat
 * itu -- sengaja belum ditangani di sini.
 *
 * Setiap percakapan yang tidak dipakai mendapat alasan, bukan dibuang diam-diam: skrip melaporkan
 * jumlah per alasan, sehingga "N pasangan" selalu bisa ditelusuri balik ke total percakapan.
 */
import type { PrismaClient } from '@prisma/client'

export type ReplayMessage = {
  id: string
  sentBy: 'BOT' | 'AGENT' | 'CUSTOMER'
  type: string
  content: string | null
  createdAt: Date
}

export type OpeningPair = {
  conversationId: string
  askedAt: Date
  /** Semua pesan teks pelanggan sebelum balasan pertama, digabung per baris. */
  customerText: string
  customerMessageIds: string[]
  /**
   * Berapa kali bot produksi akan dipanggil untuk pesan-pesan pembuka itu (burst debounce di
   * inbound.ts). Lebih dari 1 berarti replay menggabungkan beberapa giliran bot menjadi satu.
   */
  productionBurstCount: number
  /** Balasan admin dalam jendela ADMIN_REPLY_WINDOW_MS sejak balasan pertamanya, tanpa broadcast. */
  adminText: string
  adminMessageIds: string[]
  /** Gambar/video/dokumen di jendela balasan admin: tidak bisa dibandingkan, hanya dicatat. */
  adminMediaCount: number
}

export type SkipReason =
  | 'tanpa_pesan'
  | 'tidak_dibuka_pelanggan'
  | 'pembuka_bukan_teks'
  | 'pembuka_terlalu_pendek'
  | 'tanpa_balasan'
  | 'dibalas_bot'
  | 'balasan_admin_hanya_broadcast_atau_pendek'
  | 'balasan_kondisi_darurat'
  | 'sudah_booking_saat_bertanya'

export type PairResult = { ok: true; pair: OpeningPair } | { ok: false; reason: SkipReason }

export type PairOptions = {
  /** Isi pesan admin yang identik di banyak percakapan -- pengumuman, bukan jawaban. */
  broadcastContents: ReadonlySet<string>
  burstDebounceMs: number
  burstMaxWaitMs: number
}

export const MIN_CUSTOMER_CHARS = 20
export const MIN_ADMIN_CHARS = 60
/** Isi pesan admin yang muncul identik di sebanyak ini percakapan atau lebih dianggap broadcast. */
export const BROADCAST_MIN_CONVERSATIONS = 3
/**
 * Hanya pesan admin sampai 60 menit sesudah balasan pertamanya yang dihitung sebagai jawaban.
 * Tanpa batas ini, blok admin terus berlanjut sampai pelanggan bicara lagi -- replay tahap 1 ikut
 * memasukkan notifikasi booking 8 jam kemudian dan follow-up pembayaran keesokan harinya.
 */
export const ADMIN_REPLY_WINDOW_MS = 60 * 60 * 1000

/**
 * Jawaban admin selama penutupan Bromo / kebakaran hutan Ijen (Agustus-September 2026). Benar untuk
 * saat itu, tapi bukan standar jawaban normal yang harus ditiru bot.
 */
const EMERGENCY_REPLY = /forest fire|kebakaran|temporarily clos|ijen update/i

/**
 * @param bookingDay Tanggal booking pelanggan (`YYYY-MM-DD`, lihat `parseBookingDay`), atau null.
 * Pelanggan yang sudah booking dijawab produksi lewat Mode 3 (data booking), yang tidak bisa
 * direplay di percakapan sekali pakai -- membandingkannya dengan jawaban katalog tidak adil.
 */
export function buildOpeningPair(
  conversationId: string,
  messages: ReplayMessage[],
  options: PairOptions,
  bookingDay: string | null = null
): PairResult {
  // Reaksi emoji bukan giliran bicara: ia tidak boleh memutus blok pelanggan maupun blok admin.
  const ordered = messages
    .filter((m) => m.type !== 'reaction')
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  if (ordered.length === 0) return { ok: false, reason: 'tanpa_pesan' }
  if (ordered[0].sentBy !== 'CUSTOMER') return { ok: false, reason: 'tidak_dibuka_pelanggan' }

  let index = 0
  const customerBlock: ReplayMessage[] = []
  while (index < ordered.length && ordered[index].sentBy === 'CUSTOMER') customerBlock.push(ordered[index++])

  const customerTexts = customerBlock.filter((m) => m.type === 'text' && hasText(m.content))
  if (customerTexts.length === 0) return { ok: false, reason: 'pembuka_bukan_teks' }
  const customerText = customerTexts.map((m) => (m.content ?? '').trim()).join('\n')
  if (customerText.length < MIN_CUSTOMER_CHARS) return { ok: false, reason: 'pembuka_terlalu_pendek' }

  if (index >= ordered.length) return { ok: false, reason: 'tanpa_balasan' }
  if (ordered[index].sentBy === 'BOT') return { ok: false, reason: 'dibalas_bot' }

  const firstAdminAt = ordered[index].createdAt.getTime()
  const adminBlock: ReplayMessage[] = []
  while (index < ordered.length && ordered[index].sentBy === 'AGENT') {
    const message = ordered[index++]
    if (message.createdAt.getTime() - firstAdminAt <= ADMIN_REPLY_WINDOW_MS) adminBlock.push(message)
  }

  // Caption gambar/dokumen ikut dihitung: itu tetap kalimat yang ditulis admin untuk pelanggan ini.
  const adminAnswers = adminBlock.filter((m) => hasText(m.content) && !options.broadcastContents.has(m.content ?? ''))
  const adminText = adminAnswers.map((m) => (m.content ?? '').trim()).join('\n\n')
  if (adminText.length < MIN_ADMIN_CHARS) return { ok: false, reason: 'balasan_admin_hanya_broadcast_atau_pendek' }
  if (EMERGENCY_REPLY.test(adminText)) return { ok: false, reason: 'balasan_kondisi_darurat' }

  const askedAt = customerTexts[0].createdAt
  // Per hari kalender WIB, dan booking di hari yang SAMA ikut dilewati: jam booking tidak
  // tersimpan, jadi booking pagi untuk pertanyaan sore tidak bisa dibedakan dari sebaliknya.
  // Lebih baik kehilangan satu pasangan daripada menilai bot atas pertanyaan pelanggan Mode 3.
  if (bookingDay !== null && bookingDay <= jakartaDay(askedAt)) return { ok: false, reason: 'sudah_booking_saat_bertanya' }

  return {
    ok: true,
    pair: {
      conversationId,
      askedAt,
      customerText,
      customerMessageIds: customerTexts.map((m) => m.id),
      productionBurstCount: countBursts(
        customerTexts.map((m) => m.createdAt),
        options.burstDebounceMs,
        options.burstMaxWaitMs
      ),
      adminText,
      adminMessageIds: adminAnswers.map((m) => m.id),
      adminMediaCount: adminBlock.filter((m) => m.type !== 'text').length,
    },
  }
}

const MONTHS: Record<string, string> = {
  Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
  Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
}

/**
 * `bookingData.booking_date` dari API booking berbentuk "03 Sep 2026" (seluruh 157 booking di
 * produksi per 2026-09-15). Bentuk lain menghasilkan null, bukan tebakan.
 */
export function parseBookingDay(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const match = /^(\d{1,2}) ([A-Z][a-z]{2}) (\d{4})$/.exec(value.trim())
  if (!match || !MONTHS[match[2]]) return null
  return `${match[3]}-${MONTHS[match[2]]}-${match[1].padStart(2, '0')}`
}

/** Tanggal kalender di Asia/Jakarta (`YYYY-MM-DD`) -- VPS berjalan UTC. */
export function jakartaDay(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(date)
}

/**
 * Meniru scheduleBotRun/flushBurst di inbound.ts: sebuah burst di-flush pada
 * min(pesan terakhir + debounce, pesan pertama + maxWait); pesan yang datang pada atau sesudah
 * titik itu membuka burst baru.
 */
export function countBursts(times: Date[], debounceMs: number, maxWaitMs: number): number {
  let bursts = 0
  let start = 0
  let last = 0
  for (const time of times.map((t) => t.getTime()).sort((a, b) => a - b)) {
    if (bursts === 0 || time - last >= debounceMs || time - start >= maxWaitMs) {
      bursts++
      start = time
    }
    last = time
  }
  return bursts
}

/**
 * Label trace orchestrator.ts untuk giliran yang dijawab jalur cadangan (pesan "technical hiccup"),
 * bukan jalur jawaban normal. Disalin dari string di orchestrator.ts -- replay-pairs.test.ts
 * membaca file itu dan gagal kalau salah satunya tidak lagi ada, jadi salinan ini tidak bisa
 * diam-diam basi.
 */
export const FALLBACK_STEP_LABELS = [
  'Jawaban kosong atau tidak valid',
  'Knowledge tidak terbaca',
  'Terjadi kegagalan',
  'Destinasi tidak diketahui, katalog kosong',
] as const

/** Detail trace saat classifier LLM gagal/timeout dan orchestrator jatuh ke regex/kata kunci lama. */
export const LLM_FALLBACK_DETAIL = /model LLM gagal/i

/**
 * Alasan giliran ini tidak mewakili bot produksi yang sehat, atau null. Replay tahap 1 #3: empat
 * classifier timeout sekaligus, dan jawaban dari jalur regex itu terpotong di tengah kalimat --
 * menilainya berarti menilai gangguan jaringan, bukan knowledge.
 */
export function degradedReason(steps: ReadonlyArray<{ label: string; detail: string }>): string | null {
  for (const step of steps) {
    if ((FALLBACK_STEP_LABELS as readonly string[]).includes(step.label)) return step.label
    if (LLM_FALLBACK_DETAIL.test(step.detail)) return `${step.label}: LLM gagal/timeout`
  }
  return null
}

function hasText(content: string | null): boolean {
  return typeof content === 'string' && content.trim() !== ''
}

type ReplayCleanupClient = Pick<PrismaClient, 'message' | 'conversation' | 'contact'>

export const REPLAY_PHONE_PREFIX = 'replay-'

/**
 * Menghapus percakapan sekali pakai milik replay. Urutannya daun dulu: FK Message->Conversation dan
 * Conversation->Contact adalah RESTRICT (lihat cleanup() di run-eval.ts). KnowledgeGapLog dan
 * MessageDraft ikut terhapus lewat cascade. Replay tidak pernah membuat Message; penghapusannya
 * defensif. Setiap delete dibatasi prefix telepon literal, bukan id yang dikumpulkan selama run,
 * sehingga run yang crash tidak bisa meninggalkan WHERE yang cukup lebar untuk menyentuh pelanggan.
 */
export async function sweepReplayRows(client: ReplayCleanupClient): Promise<void> {
  const byPrefix = { phone: { startsWith: REPLAY_PHONE_PREFIX } }
  await client.message.deleteMany({ where: { conversation: { contact: byPrefix } } })
  await client.conversation.deleteMany({ where: { contact: byPrefix } })
  await client.contact.deleteMany({ where: byPrefix })
}

/** mulberry32 -- PRNG kecil dan deterministik, sama dengan scripts/measure-topic-accuracy.ts. */
function mulberry32(seed: number): () => number {
  let state = seed
  return function random(): number {
    state |= 0
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Fisher-Yates dengan seed tetap: sampel yang sama untuk masukan yang sama, di setiap run. */
export function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const random = mulberry32(seed)
  const copy = items.slice()
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}
