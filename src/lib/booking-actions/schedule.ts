/**
 * Pemicu ekstraksi sinyal booking dari pesan masuk (Chat -> Aksi Booking).
 *
 * --- Aturan yang menguasai file ini ---
 *
 * TIDAK BOLEH MEMPERLAMBAT ATAU MENGGAGALKAN BALASAN BOT. Dipanggil dari `ingestSingleMessage`
 * (jalur webhook produksi) tanpa await: fungsi ini hanya mengatur satu timer dan segera
 * kembali. Seluruh pekerjaan (kueri, LLM, penyimpanan) terjadi di callback timer, dibungkus
 * try/catch; kegagalan hanya ditandai `gagal` di tracer dan di-log tanpa isi pesan pelanggan.
 *
 * Debounce 8 detik per percakapan, reset tiap pesan baru (pola `scheduleBotRun`): sekumpulan
 * pesan beruntun menghasilkan satu ekstraksi atas 20 pesan terakhir.
 *
 * Gerbang, sengaja TIDAK memeriksa `botEnabled` (ekstraksi jalan juga saat bot dimatikan):
 *   - nomor Indonesia dilewati selalu, apa pun setelan bot (`isIndonesianNumber`);
 *   - percakapan uji (`isTest`) dilewati;
 *   - harus punya `bookingData`;
 *   - trip yang `date.end_ymd`-nya sebelum hari ini (WIB) dilewati;
 *   - pesan penutup/reaksi ("ok", "thanks", emoji) tidak memicu.
 */
import { prisma } from '@/lib/db'
import { isIndonesianNumber } from '@/lib/phone'
import { isNoiseMessage } from '@/lib/summary-items/noise'
import { buildNumberedTranscript } from '@/lib/daily-summary/collect'
import { jakartaDayKey } from '@/lib/daily-summary/time'
import type { BookingData } from '@/lib/booking/client'
import { traceStep, type PipelineTracer } from '@/lib/pipeline/tracer'
import { extractBookingSignals } from './extract'
import { applyExtraction, reevaluateBookingActions } from './store'

export const BOOKING_EXTRACTION_DEBOUNCE_MS = 8_000
const TRANSCRIPT_MESSAGES = 20

type Pending = { timer: ReturnType<typeof setTimeout>; tracer?: PipelineTracer }
const pending = new Map<string, Pending>()

export type ScheduleBookingExtractionOptions = {
  /** Nomor kontak; null/tidak ada = tidak bisa dinilai Indonesia, diteruskan. */
  phone?: string | null
  /** Teks pesan yang memicu, untuk saringan penutup/reaksi. */
  text?: string
}

export function scheduleBookingExtraction(
  conversationId: string,
  tracer?: PipelineTracer,
  options: ScheduleBookingExtractionOptions = {}
): void {
  try {
    if (options.phone && isIndonesianNumber(options.phone)) return
    if (options.text !== undefined && isNoiseMessage({ type: 'text', content: options.text })) return

    const existing = pending.get(conversationId)
    if (existing) clearTimeout(existing.timer)
    const timer = setTimeout(() => {
      const entry = pending.get(conversationId)
      pending.delete(conversationId)
      void runExtraction(conversationId, entry?.tracer ?? tracer)
    }, BOOKING_EXTRACTION_DEBOUNCE_MS)
    // Timer ini tidak boleh menahan proses mati.
    if (typeof timer === 'object' && 'unref' in timer) timer.unref()
    pending.set(conversationId, { timer, tracer })
  } catch (error) {
    console.error('[booking-actions] scheduleBookingExtraction gagal', error instanceof Error ? error.message : 'unknown')
  }
}

async function runExtraction(conversationId: string, tracer: PipelineTracer | undefined): Promise<void> {
  try {
    const conv = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { bookingData: true, isTest: true, contact: { select: { phone: true } } },
    })
    if (!conv || conv.isTest || !conv.bookingData) {
      traceStep(tracer, 'ekstrak-booking', 'dilewati', { alasan: 'tidak ada booking' })
      return
    }
    // Defensif: gerbang nomor juga di sini, bila pemanggil tidak menyertakan nomor.
    if (isIndonesianNumber(conv.contact?.phone ?? null)) {
      traceStep(tracer, 'ekstrak-booking', 'dilewati', { alasan: 'nomor Indonesia' })
      return
    }
    const booking = conv.bookingData as BookingData
    const endYmd = booking.date?.end_ymd
    if (endYmd && endYmd < jakartaDayKey(new Date())) {
      traceStep(tracer, 'ekstrak-booking', 'dilewati', { alasan: 'trip sudah berakhir' })
      return
    }

    const latest = await prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      take: TRANSCRIPT_MESSAGES,
      select: { id: true, direction: true, sentBy: true, type: true, content: true, createdAt: true },
    })
    if (latest.length === 0) {
      traceStep(tracer, 'ekstrak-booking', 'dilewati', { alasan: 'belum ada pesan' })
      return
    }
    const transcript = buildNumberedTranscript([...latest].reverse())
    const extraction = await extractBookingSignals({ transcript, booking })
    if (!extraction) {
      traceStep(tracer, 'ekstrak-booking', 'gagal', { alasan: 'ekstraksi gagal' })
      return
    }
    await applyExtraction(conversationId, extraction)
    await reevaluateBookingActions(conversationId)
    traceStep(tracer, 'ekstrak-booking', 'selesai')
  } catch (error) {
    console.error('[booking-actions] ekstraksi gagal', { conversationId, error: error instanceof Error ? error.message : 'unknown' })
    traceStep(tracer, 'ekstrak-booking', 'gagal', { alasan: 'galat tak terduga' })
  }
}

// Test-only: membatalkan timer yang tertinggal antar kasus.
export function __resetBookingExtractionForTests(): void {
  for (const p of pending.values()) clearTimeout(p.timer)
  pending.clear()
}
