/**
 * Ambang ringkasan chat harian (/summary). Satu tempat, supaya angka yang ditampilkan halaman
 * dan angka yang dipakai job tidak pernah bisa berbeda.
 *
 * Alasan tiap angka (disepakati owner 2026-09-22):
 * - Belum dibalas: TANPA jeda (owner 2026-11-26: "balas kalo memang gak dibalas aja, jangan nunggu 1 jam").
 *   Dulu 1 jam (2026-09-22); kini pesan pelanggan terakhir yang belum dibalas langsung masuk Balas lewat tick 5 menit
 *   atau saat Antrean dibuka, dan tertutup sendiri begitu dibalas (reconcile).
 * - 48 jam pelanggan diam: tamu asing beda zona waktu dan sering berdiskusi dulu dengan
 *   rombongannya; 24 jam terlalu dini untuk disebut menggantung.
 * - 14 hari ke belakang: lead yang lebih tua sudah dingin, dan daftar yang terus menumpuk
 *   berhenti dibaca.
 */
const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

export const UNREPLIED_MIN_MS = 0
export const DORMANT_MIN_MS = 2 * DAY_MS
export const LOOKBACK_MS = 14 * DAY_MS
/** Tahap booked/lunas/selesai sudah bukan lead yang perlu dikejar. */
export const DORMANT_STAGES: readonly string[] = ['new', 'nego']

/** Pesan terakhir per percakapan yang dikirim ke LLM. */
export const TRANSCRIPT_MAX_MESSAGES = 30
/**
 * Satu pesan panjang (itinerary yang di-paste) tidak boleh menghabiskan seluruh prompt. 2000 (dari 1000, audit 2026-11-25):
 * balasan admin JVTO rutin > 1000 huruf, dan bagian akhirnya (tautan harga, "thank you for considering") yang hilang
 * membuat model mengira harga belum dikirim (Félix). Yang tetap terpotong diberi penanda `TRANSCRIPT_CUT_MARK`.
 */
export const TRANSCRIPT_MAX_CHARS_PER_MESSAGE = 2000
export const TRANSCRIPT_CUT_MARK = '…[dipotong]'

/** Jauh di atas default 10 s llm.ts: job ini di luar jalur webhook, tidak ada yang menunggu. */
export const REVIEW_TIMEOUT_MS = 60_000
export const REVIEW_CONCURRENCY = 3

/** Keputusan owner 2026-09-22: payload memuat nama & cuplikan chat pelanggan. */
export const RETENTION_MS = 30 * DAY_MS

/** Baris RUNNING yang lebih muda dari ini dianggap masih jalan; lebih tua = proses yang mati. */
export const RUNNING_STALE_MS = 30 * 60 * 1000

export const SNIPPET_MAX_CHARS = 160
