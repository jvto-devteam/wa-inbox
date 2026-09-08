/**
 * Merekam perjalanan SATU pesan pelanggan melewati langkah-langkah `steps.ts`, sambil
 * menyiarkannya ke kanvas live.
 *
 * --- Satu aturan yang menguasai file ini ---
 *
 * MODUL INI TIDAK BOLEH MENGUBAH APA PUN YANG DILAKUKAN BOT. Ia dipasang di `inbound.ts` dan
 * `orchestrator.ts` — jalur pesan pelanggan yang hidup di produksi. Karena itu setiap metode
 * publik di sini dibungkus try/catch dan mengembalikan `void`: gagal menyiarkan, gagal
 * membersihkan detail, gagal apa pun, tidak boleh menghentikan satu balasan pun. Polanya sama
 * dengan `recordBotDecisionRun` (decision-recorder.ts) dan `recoverStuckOutboundJobs`
 * (outbound/worker.ts), yang mengambil keputusan sama karena alasan sama.
 *
 * Konsekuensinya: kalau instrumentasi rusak, kanvas jadi kosong atau bolong — dan itu memang
 * hasil yang diinginkan. Kanvas yang bohong jauh lebih murah daripada pelanggan yang tidak
 * dibalas.
 *
 * --- Kenapa `runId` dibuat di sini, bukan oleh Prisma ---
 *
 * Kanvas live harus bisa menunjuk baris `BotDecisionRun` yang sama dengan yang nanti muncul di
 * Decision Logs. Kalau id-nya dibuat Prisma saat baris ditulis (yaitu SETELAH keputusan
 * selesai), setiap event yang disiarkan selama run berlangsung tidak punya id apa pun untuk
 * dirujuk — tampilan live dan riwayat menjadi dua dunia terpisah yang tidak bisa dijahit.
 * Karena itu id dibuat di awal penanganan pesan dan diserahkan ke `recordBotDecisionRun`
 * sebagai `id` eksplisit. Kolom `BotDecisionRun.id` adalah String biasa, jadi UUID sah di sana.
 *
 * --- Kenapa ada batas jumlah step dan ukuran detail ---
 *
 * `steps` adalah kolom Json tanpa skema, dan step di-push dari selusin tempat. Satu run aneh
 * (loop tak terduga, error yang membawa payload raksasa) tanpa batas berarti satu baris Json
 * raksasa yang permanen di database dan satu event SSE raksasa ke setiap tab yang terbuka.
 * Batasnya keras dan diam: melewati batas berarti step berikutnya diabaikan, bukan dilempar.
 */
import { broadcast } from '@/lib/realtime'
import { sanitizeTrace } from '@/lib/bot-control/trace-sanitizer'
import type { PipelineStepId } from '@/lib/pipeline/steps'

/**
 * Status satu batas step.
 * - `mulai`    — step dimasuki, belum selesai (dipakai untuk step yang lama: LLM, verifikasi).
 * - `selesai`  — step tuntas dan run berlanjut.
 * - `dilewati` — step memang tidak dijalankan pada jalur ini (mis. katalog dilewati karena
 *                pelanggan punya booking aktif).
 * - `berhenti` — run BERAKHIR di sini secara sah: bot nonaktif, rate limit, pesan non-teks,
 *                agent sudah mengambil alih. Bukan kegagalan, tapi juga bukan lanjut.
 * - `gagal`    — run berakhir karena exception.
 */
export type PipelineStepStatus = 'mulai' | 'selesai' | 'dilewati' | 'berhenti' | 'gagal'

export type PipelineStepRecord = {
  stepId: PipelineStepId
  status: PipelineStepStatus
  /** ISO-8601. Disimpan sebagai string supaya kolom Json-nya bisa dibaca apa adanya. */
  at: string
  detail?: unknown
}

/**
 * Maksimum entri per run. 11 step × (mulai + selesai) = 22 pada jalur terpanjang yang wajar;
 * 64 memberi ruang besar untuk jalur tak terduga tanpa pernah mendekati ukuran Json yang jadi
 * masalah. Entri ke-65 dan seterusnya dibuang diam-diam.
 */
const MAX_STEPS_PER_RUN = 64

/**
 * Batas panjang JSON detail satu step, dalam karakter. Detail di sini adalah catatan pendek
 * ("alasan": "rate limit terlampaui"), bukan payload. Yang lebih panjang dipotong menjadi
 * penanda, bukan dibuang seluruhnya — supaya kelihatan bahwa ada sesuatu yang terlalu besar.
 */
const MAX_DETAIL_CHARS = 512

/**
 * Membuat id run. `crypto.randomUUID` adalah bawaan Node 22 (dan Web Crypto di runtime edge),
 * jadi tidak ada dependensi baru. Fallback-nya ada karena file ini tidak boleh melempar,
 * bahkan di lingkungan tes yang meng-stub global `crypto`.
 */
function newRunId(): string {
  try {
    return globalThis.crypto.randomUUID()
  } catch {
    return `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
  }
}

/**
 * Membersihkan lalu memotong `detail`.
 *
 * `sanitizeTrace` adalah aturan mutlak proyek, bukan pilihan: token/API key tidak boleh muncul
 * di UI, response API, maupun log — dan `detail` melewati KETIGANYA (kolom Json, event SSE ke
 * setiap tab, dan konsol saat debugging). Dibersihkan SEBELUM disimpan/disiarkan, bukan saat
 * render, dengan alasan yang sama seperti di decision-recorder.ts: rahasia yang sudah mendarat
 * di database bersifat permanen.
 */
function prepareDetail(detail: unknown): unknown {
  if (detail === undefined) return undefined
  const sanitized = sanitizeTrace(detail)
  let serialized: string
  try {
    serialized = JSON.stringify(sanitized) ?? ''
  } catch {
    return { _error: 'Detail step tidak bisa diserialisasi' }
  }
  if (serialized.length > MAX_DETAIL_CHARS) {
    return { _terpotong: `Detail step ${serialized.length} karakter, melewati batas ${MAX_DETAIL_CHARS}` }
  }
  return sanitized
}

export type PipelineTracer = {
  /** Id run — juga menjadi `BotDecisionRun.id` bila run ini sampai tercatat. */
  readonly runId: string
  readonly conversationId: string
  /**
   * Menandai satu batas step. Tidak pernah melempar.
   *
   * Menandai step BARU sementara step sebelumnya masih `mulai` akan menutup yang sebelumnya
   * sebagai `selesai` lebih dulu. Itu yang membuat call site cukup satu baris per step: jalur
   * dengan belasan early return tidak perlu menutup step-nya sendiri satu per satu, dan tidak
   * ada step yang menggantung hanya karena sebuah cabang keluar lebih awal.
   */
  mark(stepId: PipelineStepId, status: PipelineStepStatus, detail?: unknown): void
  /**
   * Menutup step yang masih `mulai` dengan status akhir. Dipakai di `catch` — di sana yang
   * diketahui hanya "run mati", bukan step mana yang seharusnya berikutnya. No-op bila tidak
   * ada step yang terbuka.
   */
  closeOpen(status: PipelineStepStatus, detail?: unknown): void
  /** Salinan step yang terkumpul, siap ditulis ke kolom Json. Tidak pernah melempar. */
  snapshot(): PipelineStepRecord[]
}

/**
 * Tracer yang tidak melakukan apa-apa. Dipakai sebagai default oleh pemanggil yang tidak punya
 * tracer (mis. `runBotForConversation` yang dipanggil langsung dari test) supaya tidak ada
 * `?.` yang tercecer di jalur panas — dan supaya "tanpa tracer" tidak pernah berarti "crash".
 */
export function createNoopPipelineTracer(): PipelineTracer {
  return {
    runId: '',
    conversationId: '',
    mark: () => {},
    closeOpen: () => {},
    snapshot: () => [],
  }
}

/**
 * Membuat tracer untuk satu run.
 *
 * @param conversationId percakapan yang sedang ditangani; ikut di setiap event supaya kanvas
 *   bisa memfilter per-percakapan tanpa query tambahan.
 * @param runId id yang sudah ada, bila run ini melanjutkan run yang sudah dimulai. Default:
 *   id baru.
 */
export function createPipelineTracer(conversationId: string, runId: string = newRunId()): PipelineTracer {
  const steps: PipelineStepRecord[] = []
  let openStepId: PipelineStepId | null = null

  function record(stepId: PipelineStepId, status: PipelineStepStatus, detail?: unknown): void {
    if (steps.length >= MAX_STEPS_PER_RUN) return
    const at = new Date().toISOString()
    const prepared = prepareDetail(detail)
    steps.push(prepared === undefined ? { stepId, status, at } : { stepId, status, at, detail: prepared })
    openStepId = status === 'mulai' ? stepId : null
    // Disiarkan di dalam try-nya sendiri: sebuah listener SSE yang controller-nya sudah
    // ditutup melempar dari dalam `broadcast`, dan itu tidak boleh menghapus step yang sudah
    // terkumpul (baris di atas sengaja dieksekusi lebih dulu) apalagi menghentikan run.
    try {
      broadcast({
        type: 'pipeline.step',
        runId,
        conversationId,
        stepId,
        status,
        at,
        ...(prepared === undefined ? {} : { detail: prepared }),
      })
    } catch (error) {
      console.error('pipeline tracer: broadcast gagal', { runId, stepId, error })
    }
  }

  return {
    runId,
    conversationId,
    mark(stepId, status, detail) {
      try {
        if (openStepId !== null && openStepId !== stepId) {
          const previous = openStepId
          openStepId = null
          record(previous, 'selesai')
        }
        record(stepId, status, detail)
      } catch (error) {
        console.error('pipeline tracer: mark gagal', { runId, stepId, error })
      }
    },
    closeOpen(status, detail) {
      try {
        if (openStepId === null) return
        const previous = openStepId
        openStepId = null
        record(previous, status, detail)
      } catch (error) {
        console.error('pipeline tracer: closeOpen gagal', { runId, error })
      }
    },
    snapshot() {
      try {
        return steps.map((step) => ({ ...step }))
      } catch {
        return []
      }
    },
  }
}

/**
 * --- Kenapa ada lapisan fungsi bebas di bawah ini ---
 *
 * `createPipelineTracer` di atas sudah membungkus setiap metodenya sendiri, jadi tracer ASLI
 * memang tidak bisa melempar. Itu belum cukup. Yang dipasang di `inbound.ts` dan
 * `orchestrator.ts` adalah sebuah OBJEK yang datang dari luar — dari parameter, dari default,
 * kelak mungkin dari test double atau dari implementasi lain. Kalau jalur panas memanggil
 * `tracer.mark(...)` langsung, jaminannya bergantung pada siapa pun yang menyediakan objek itu.
 *
 * Fungsi-fungsi di bawah memindahkan jaminan itu ke SISI PEMANGGIL: apa pun yang diberikan —
 * tracer asli, tracer palsu yang selalu melempar, bahkan `undefined` — pesan pelanggan tetap
 * diproses dan dibalas persis sama. Itulah kenapa jalur panas hanya memanggil ini, tidak pernah
 * metodenya langsung.
 */

/** Membuka run baru. Mengembalikan tracer kosong (bukan melempar) bila pembuatannya gagal. */
export function openPipelineRun(conversationId: string, runId?: string): PipelineTracer {
  try {
    return createPipelineTracer(conversationId, runId)
  } catch (error) {
    console.error('pipeline tracer: gagal membuka run', { conversationId, error })
    return createNoopPipelineTracer()
  }
}

/** Menandai satu batas step. Tidak pernah melempar, apa pun `tracer`-nya. */
export function traceStep(
  tracer: PipelineTracer | undefined,
  stepId: PipelineStepId,
  status: PipelineStepStatus,
  detail?: unknown
): void {
  try {
    tracer?.mark(stepId, status, detail)
  } catch (error) {
    console.error('pipeline tracer: traceStep gagal', { stepId, status, error })
  }
}

/** Menutup step yang masih terbuka. Tidak pernah melempar, apa pun `tracer`-nya. */
export function traceClose(tracer: PipelineTracer | undefined, status: PipelineStepStatus, detail?: unknown): void {
  try {
    tracer?.closeOpen(status, detail)
  } catch (error) {
    console.error('pipeline tracer: traceClose gagal', { status, error })
  }
}

/** Salinan step untuk kolom Json. Mengembalikan `undefined` bila tidak ada apa-apa untuk ditulis. */
export function traceSnapshot(tracer: PipelineTracer | undefined): PipelineStepRecord[] | undefined {
  try {
    const steps = tracer?.snapshot()
    return Array.isArray(steps) && steps.length > 0 ? steps : undefined
  } catch (error) {
    console.error('pipeline tracer: traceSnapshot gagal', { error })
    return undefined
  }
}

/**
 * Id run untuk dipakai sebagai `BotDecisionRun.id`. `undefined` bila tidak ada — dan `undefined`
 * di sana berarti Prisma membuat `cuid()`-nya sendiri, persis perilaku sebelum fitur ini ada.
 */
export function traceRunId(tracer: PipelineTracer | undefined): string | undefined {
  try {
    return tracer?.runId || undefined
  } catch (error) {
    console.error('pipeline tracer: traceRunId gagal', { error })
    return undefined
  }
}
