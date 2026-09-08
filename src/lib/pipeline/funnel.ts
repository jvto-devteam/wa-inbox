/**
 * Tahap funnel penjualan satu percakapan, diturunkan dari KELENGKAPAN `TripBrief`.
 *
 * Kenapa dari TripBrief dan bukan dari J1–J5: `classifySalesNeed` (src/lib/bot/sales-classifier.ts)
 * mengembalikan KELAS INTENT, bukan tahap. J1–J5 tidak linier — satu pelanggan bisa bolak-balik
 * antara J2 dan J4 dalam satu percakapan, dan J5 (eskalasi) bukan "lebih jauh" daripada J1.
 * Memperlakukannya sebagai tangga akan menghasilkan funnel yang naik-turun tanpa arti.
 * `TripBrief` (kolom `Conversation.tripBrief`, tipe di src/lib/bot/types.ts) justru monoton:
 * field-nya di-merge, tidak pernah dihapus, jadi kelengkapannya hanya bisa bertambah.
 *
 * Tiga field yang menentukan tangga, memakai nama field TripBrief yang sebenarnya:
 *   `destination` → `pax` → `dateRange`
 *
 * Fakta handoff TIDAK ada di TripBrief dan sengaja diminta sebagai argumen terpisah, supaya modul
 * ini tetap murni. Pemanggil menentukan sendiri sumbernya — `Conversation.botEnabled === false`
 * (dimatikan oleh runBotForConversation setiap kali handoff terjadi) atau status HANDOFF pada
 * BotDecisionRun terakhir.
 *
 * Modul ini MURNI: tanpa database, tanpa jaringan. `tripBrief` diterima sebagai `unknown` dengan
 * sengaja — kolomnya Json bebas di database, isinya bisa null, array, string, atau objek dengan
 * field bertipe salah, dan fungsi ini TIDAK BOLEH melempar untuk apa pun dari sana.
 */

export type FunnelStage =
  | 'MASUK'
  | 'TANYA'
  | 'ADA_TUJUAN'
  | 'ADA_ROMBONGAN'
  | 'ADA_TANGGAL'
  | 'DITERUSKAN'

export type FunnelStageInfo = {
  id: FunnelStage
  label: string
  description: string
}

/**
 * Urut dari paling awal ke paling akhir. `DITERUSKAN` ditaruh terakhir karena ia adalah muara,
 * bukan karena ia "lebih lengkap" — sebuah percakapan bisa diserahkan ke agen dari tahap mana pun.
 */
export const FUNNEL_STAGES: readonly FunnelStageInfo[] = [
  {
    id: 'MASUK',
    label: 'Masuk',
    description: 'Pesan sudah diterima, belum ada satu pun keterangan perjalanan yang tercatat.',
  },
  {
    id: 'TANYA',
    label: 'Bertanya',
    description:
      'Percakapan sudah berjalan (ada topik, preferensi, atau catatan tercatat), tapi tujuan perjalanan belum diketahui.',
  },
  {
    id: 'ADA_TUJUAN',
    label: 'Ada tujuan',
    description: 'Pelanggan sudah menyebut destinasi yang diinginkan.',
  },
  {
    id: 'ADA_ROMBONGAN',
    label: 'Ada rombongan',
    description: 'Destinasi dan jumlah peserta sudah diketahui.',
  },
  {
    id: 'ADA_TANGGAL',
    label: 'Ada tanggal',
    description: 'Destinasi, jumlah peserta, dan rentang tanggal lengkap — siap ditindaklanjuti.',
  },
  {
    id: 'DITERUSKAN',
    label: 'Diteruskan ke agen',
    description:
      'Percakapan sudah diserahkan ke manusia. Ini menang atas tahap kelengkapan mana pun.',
  },
] as const

export const FUNNEL_STAGE_LABELS: Record<FunnelStage, string> = FUNNEL_STAGES.reduce(
  (acc, stage) => {
    acc[stage.id] = stage.label
    return acc
  },
  {} as Record<FunnelStage, string>
)

/** Posisi tahap pada urutan funnel (0-based). -1 untuk nilai yang tidak dikenal. */
export function funnelStageIndex(stage: FunnelStage): number {
  return FUNNEL_STAGES.findIndex((entry) => entry.id === stage)
}

/**
 * Field TripBrief yang, bila salah satunya terisi DENGAN TIPE YANG BENAR, membuktikan percakapan
 * sudah benar-benar berjalan meski tujuan belum diketahui — itulah tahap TANYA.
 *
 * Dua keputusan sengaja di sini. Pertama, daftarnya eksplisit dan bukan sekadar "objek tidak
 * kosong": kunci asing sisa versi lama tidak boleh menaikkan tahap. Kedua, tipenya ikut dicek:
 * `{ destination: 12 }` adalah data rusak, bukan bukti percakapan berjalan, jadi ia jatuh ke
 * MASUK — kalau tidak, satu field bertipe salah bisa menaikkan tahap tanpa satu pun informasi
 * yang benar-benar terbaca. Diambil dari `TripBrief` di src/lib/bot/types.ts.
 */
const ENGAGEMENT_FIELDS: ReadonlyArray<{ field: string; kind: 'text' | 'count' | 'flag' | 'list' }> = [
  { field: 'destination', kind: 'text' },
  { field: 'dateRange', kind: 'text' },
  { field: 'pax', kind: 'count' },
  { field: 'notes', kind: 'text' },
  { field: 'lastTopic', kind: 'text' },
  { field: 'origin', kind: 'text' },
  { field: 'dayCount', kind: 'count' },
  { field: 'finishCity', kind: 'text' },
  { field: 'requestedTokens', kind: 'list' },
  { field: 'askedTripPreferences', kind: 'flag' },
  { field: 'declinedTripPreferences', kind: 'flag' },
  { field: 'awaitingTripPreferencesAnswer', kind: 'flag' },
]

function asRecord(value: unknown): Record<string, unknown> | null {
  // Array lolos `typeof === 'object'`, jadi harus ditolak eksplisit: `['bromo']` bukan brief.
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

/** String dianggap terisi hanya bila benar-benar ada isinya — `''` dan `'   '` sama dengan kosong. */
function hasText(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

/** Angka peserta dianggap terisi hanya bila bilangan hingga dan positif. `0`, NaN, `'4'` tidak. */
function hasCount(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

/** Daftar token dianggap terisi bila ada minimal satu string yang benar-benar berisi. */
function hasList(value: unknown): boolean {
  return Array.isArray(value) && value.some((entry) => hasText(entry))
}

function hasAnyEngagement(brief: Record<string, unknown>): boolean {
  return ENGAGEMENT_FIELDS.some(({ field, kind }) => {
    const value = brief[field]
    if (kind === 'text') return hasText(value)
    if (kind === 'count') return hasCount(value)
    if (kind === 'list') return hasList(value)
    return value === true
  })
}

export type FunnelStageInput = {
  /** Isi `Conversation.tripBrief` apa adanya. Bentuk apa pun diterima; tidak pernah melempar. */
  tripBrief: unknown
  /**
   * Percakapan sudah diserahkan ke manusia. Sumbernya urusan pemanggil — lihat header file.
   * Bila true, hasilnya selalu `DITERUSKAN`.
   */
  handedOff?: boolean
}

/**
 * Tahap funnel saat ini.
 *
 * Monoton terhadap kelengkapan: syarat tiap anak tangga adalah superset dari syarat tangga di
 * bawahnya (`destination` ⊂ `destination`+`pax` ⊂ `destination`+`pax`+`dateRange`), sehingga
 * menambah field tidak pernah menurunkan tahap. `funnel.test.ts` menegakkan itu atas seluruh
 * kombinasi field.
 */
export function resolveFunnelStage(input: FunnelStageInput): FunnelStage {
  // Menang atas apa pun, termasuk brief yang rusak: begitu percakapan diserahkan ke manusia,
  // itulah tahapnya — tidak peduli seberapa lengkap datanya.
  if (input.handedOff === true) return 'DITERUSKAN'

  const brief = asRecord(input.tripBrief)
  if (!brief) return 'MASUK'

  const hasDestination = hasText(brief.destination)
  const hasPax = hasCount(brief.pax)
  const hasDateRange = hasText(brief.dateRange)

  if (hasDestination && hasPax && hasDateRange) return 'ADA_TANGGAL'
  if (hasDestination && hasPax) return 'ADA_ROMBONGAN'
  if (hasDestination) return 'ADA_TUJUAN'
  if (hasAnyEngagement(brief)) return 'TANYA'
  return 'MASUK'
}
