/**
 * Membaca kolom Json `BotDecisionRun.steps` menjadi sesuatu yang boleh dipercaya UI.
 *
 * Kolomnya Json bebas dan NULLABLE, dan kedua keadaan itu punya arti yang berbeda:
 *   - NULL  → run ini berjalan SEBELUM instrumentasi ada, atau lewat jalur tanpa tracer
 *             (simulator Test Lab). Jejaknya tidak pernah direkam. Itu BUKAN kegagalan.
 *   - array → jejak yang benar-benar direkam `src/lib/pipeline/tracer.ts`.
 *
 * Membedakan keduanya adalah seluruh alasan file ini ada. Kalau "tidak terekam" dan "gagal"
 * dicampur, setiap baris lama di tabel akan terlihat seperti bot yang rusak — riwayat yang
 * berbohong tentang masa lalunya sendiri.
 *
 * Modul ini MURNI dan defensif: apa pun isi kolomnya (null, string, angka, array berisi
 * sampah, stepId yang sudah tidak ada lagi di `steps.ts`) tidak boleh melempar dan tidak boleh
 * menghasilkan stepId yang tidak dikenal kanvas. Entri yang tidak bisa dibaca DIBUANG, bukan
 * ditebak: kanvas yang menyalakan node berdasarkan id karangan lebih buruk daripada kanvas
 * yang bolong.
 *
 * `import type` dari tracer.ts disengaja — tracer menarik `@/lib/realtime` dan hanya boleh
 * hidup di server, sementara tipe-tipenya terhapus saat kompilasi sehingga modul ini tetap
 * aman diimpor dari mana pun.
 */
import { getPipelineStep, type PipelineStepId } from '@/lib/pipeline/steps'
import type { PipelineStepRecord, PipelineStepStatus } from '@/lib/pipeline/tracer'

const KNOWN_STATUSES: readonly string[] = ['mulai', 'selesai', 'dilewati', 'berhenti', 'gagal']

/**
 * Batas jumlah entri yang dibaca dari satu baris. Tracer sudah membatasi di 64 saat MENULIS;
 * batas di sini melindungi dari baris lama atau baris yang ditulis tangan, sehingga satu baris
 * aneh di database tidak bisa menjadi satu halaman yang menggantung.
 */
const MAX_PARSED_STEPS = 200

/**
 * Jejak langkah satu run, atau `null` bila memang tidak pernah terekam.
 *
 * Array kosong (`[]`) sengaja TIDAK disamakan dengan null di sini: yang satu berarti kolomnya
 * berisi sesuatu yang tidak bisa dibaca, yang lain berarti kolomnya memang kosong. Yang
 * menggabungkan keduanya menjadi satu kalimat untuk operator adalah `summarisePipelineSteps`.
 */
export function parsePipelineSteps(value: unknown): PipelineStepRecord[] | null {
  if (!Array.isArray(value)) return null

  const parsed: PipelineStepRecord[] = []
  for (const entry of value.slice(0, MAX_PARSED_STEPS)) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue
    const record = entry as Record<string, unknown>

    const stepId = record.stepId
    // Dicek terhadap registry, bukan sekadar "string": step yang dihapus dari steps.ts tidak
    // punya kotak di kanvas, jadi menyalakannya mustahil dan menampilkannya menyesatkan.
    if (typeof stepId !== 'string' || getPipelineStep(stepId) === null) continue

    const status = record.status
    if (typeof status !== 'string' || !KNOWN_STATUSES.includes(status)) continue

    parsed.push({
      stepId: stepId as PipelineStepId,
      status: status as PipelineStepStatus,
      // Waktu yang hilang menjadi string kosong, bukan alasan membuang seluruh entri: yang
      // penting bagi kanvas adalah step mana dengan status apa.
      at: typeof record.at === 'string' ? record.at : '',
      ...(record.detail === undefined ? {} : { detail: record.detail }),
    })
  }
  return parsed
}

export type PipelineRunStepsSummary = {
  /** false berarti "tidak terekam" — lihat header file. Bukan sinonim dari gagal. */
  recorded: boolean
  stepCount: number
  lastStepId: PipelineStepId | null
  lastStatus: PipelineStepStatus | null
}

/**
 * Ringkasan untuk DAFTAR run: cukup untuk satu baris tabel, tanpa mengirim seluruh jejak ke
 * browser. Halaman daftar tidak menggambar jejaknya, hanya menyebut di mana run berhenti.
 */
export function summarisePipelineSteps(value: unknown): PipelineRunStepsSummary {
  const steps = parsePipelineSteps(value)
  if (steps === null || steps.length === 0) {
    return { recorded: false, stepCount: 0, lastStepId: null, lastStatus: null }
  }
  const last = steps[steps.length - 1]
  return { recorded: true, stepCount: steps.length, lastStepId: last.stepId, lastStatus: last.status }
}
