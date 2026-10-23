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
 * Jalur samping punya run pipeline-nya SENDIRI (`openPipelineRun` di dalam callback), tidak
 * pernah memakai tracer milik burst bot: `tracer.mark` menutup step yang masih terbuka sebagai
 * 'selesai', jadi memakai tracer bot akan memalsukan jejak balasan yang sedang berjalan.
 *
 * Gerbang, sengaja TIDAK memeriksa `botEnabled` (ekstraksi jalan juga saat bot dimatikan):
 *   - rollout (Ruling R25, `rollout.ts`): selama `BOOKING_ACTIONS_ROLLOUT` bukan `all`, hanya percakapan uji
 *     (`isTest` atau nomor `BOOKING_ACTIONS_TEST_PHONES`) yang diekstraksi;
 *   - nomor Indonesia dilewati selalu, apa pun setelan bot (`isIndonesianNumber`), KECUALI
 *     percakapan uji (`isTest`, Ruling R13, atau nomor uji R25): nomor whitelist 6282143403501
 *     satu-satunya kanal uji yang diizinkan dan berawalan 62;
 *   - harus punya `bookingData`;
 *   - trip yang `date.end_ymd`-nya sebelum hari ini (WIB) dilewati;
 *   - pesan penutup/reaksi ("ok", "thanks", emoji) tidak memicu.
 *
 * Sesudah ekstraksi selesai (jalur yang lolos gerbang), ringkasan chat di panel kanan ikut
 * diperbarui oleh jalur masuk pesan (`noteInboundForChatReview`), bukan dari sini.
 */
import { prisma } from '@/lib/db'
import { isNoiseMessage } from '@/lib/summary-items/noise'
import { buildNumberedTranscript } from '@/lib/daily-summary/collect'
import { jakartaDayKey } from '@/lib/daily-summary/time'
import type { BookingData } from '@/lib/booking/client'
import { openPipelineRun, traceClose, traceStep } from '@/lib/pipeline/tracer'
import { extractBookingSignals } from './extract'
import { applyExtraction, reevaluateBookingActions } from './store'
import { autoApplyCreated } from './auto-apply'
import { notifyGuestRequestReceived } from './guest-ack'
import { reportAiActivity } from '@/lib/ai-office/activity'
import { blockedByIndonesianGate, bookingAutomationAllowed } from './rollout'

export const BOOKING_EXTRACTION_DEBOUNCE_MS = 8_000
const TRANSCRIPT_MESSAGES = 20

type Pending = { timer: ReturnType<typeof setTimeout> }
const pending = new Map<string, Pending>()

// Gerbang nomor Indonesia dinilai di callback (butuh `isTest` dari DB), bukan di sini.
export type ScheduleBookingExtractionOptions = {
  /** Teks pesan yang memicu, untuk saringan penutup/reaksi. */
  text?: string
}

export function scheduleBookingExtraction(
  conversationId: string,
  options: ScheduleBookingExtractionOptions = {}
): void {
  try {
    if (options.text !== undefined && isNoiseMessage({ type: 'text', content: options.text })) return

    const existing = pending.get(conversationId)
    if (existing) clearTimeout(existing.timer)
    const timer = setTimeout(() => {
      pending.delete(conversationId)
      void runExtraction(conversationId)
    }, BOOKING_EXTRACTION_DEBOUNCE_MS)
    // Timer ini tidak boleh menahan proses mati.
    if (typeof timer === 'object' && 'unref' in timer) timer.unref()
    pending.set(conversationId, { timer })
  } catch (error) {
    console.error('[booking-actions] scheduleBookingExtraction gagal', error instanceof Error ? error.message : 'unknown')
  }
}

/**
 * Jalankan ekstraksi SEKARANG (membatalkan jadwal debounce yang menunggu), untuk jalur bot: owner 2026-10-21 meminta
 * satu permintaan perubahan = SATU WhatsApp ke tamu (kabar "sudah diperbarui"), jadi bot tidak boleh ikut menjawab
 * pesan yang sudah menjadi kartu. `true` = run ini melahirkan kartu CHANGE/TASK (bot diam). Tidak pernah melempar.
 */
export async function runBookingExtractionNow(conversationId: string): Promise<boolean> {
  const existing = pending.get(conversationId)
  if (existing) {
    clearTimeout(existing.timer)
    pending.delete(conversationId)
  }
  try {
    return await runExtraction(conversationId)
  } catch {
    return false
  }
}

async function runExtraction(conversationId: string): Promise<boolean> {
  // Run sendiri; tidak pernah menyentuh tracer burst bot.
  const run = openPipelineRun(conversationId)
  // Kantor AI: hanya bila percakapan memang lolos gerbang (lihat `extracting` di bawah).
  let extracting = false
  traceStep(run, 'ekstrak-booking', 'mulai')
  try {
    const conv = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { bookingData: true, isTest: true, contact: { select: { phone: true } } },
    })
    if (!conv || !conv.bookingData) {
      traceClose(run, 'dilewati', { alasan: 'tidak ada booking' })
      return false
    }
    const gate = { isTest: conv.isTest, phone: conv.contact?.phone ?? null }
    if (!bookingAutomationAllowed(gate)) {
      traceClose(run, 'dilewati', { alasan: 'rollout uji' })
      return false
    }
    if (blockedByIndonesianGate(gate)) {
      traceClose(run, 'dilewati', { alasan: 'nomor Indonesia' })
      return false
    }
    const booking = conv.bookingData as BookingData
    const endYmd = booking.date?.end_ymd
    if (endYmd && endYmd < jakartaDayKey(new Date())) {
      traceClose(run, 'dilewati', { alasan: 'trip sudah berakhir' })
      return false
    }

    const latest = await prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      take: TRANSCRIPT_MESSAGES,
      select: { id: true, direction: true, sentBy: true, type: true, content: true, createdAt: true },
    })
    if (latest.length === 0) {
      traceClose(run, 'dilewati', { alasan: 'belum ada pesan' })
      return false
    }
    const transcript = buildNumberedTranscript([...latest].reverse())
    // Hanya pesan TAMU yang boleh jadi sumber usulan/fakta (pesan tim tidak pernah).
    const inboundIds = new Set(latest.filter((m) => m.direction === 'INBOUND').map((m) => m.id))
    extracting = true
    reportAiActivity('booking', 'mulai', 'Membaca permintaan perubahan booking', conversationId)
    const extraction = await extractBookingSignals({ transcript, booking, inboundIds })
    if (!extraction) {
      traceClose(run, 'gagal', { alasan: 'ekstraksi gagal' })
      reportAiActivity('booking', 'gagal', 'Gagal membaca permintaan', conversationId)
      return false
    }
    const applied = await applyExtraction(conversationId, extraction)
    // Push CHANGE tertunda: apa pun yang terjadi pada reevaluate, `autoApplyCreated` tetap jalan agar admin dikabari.
    try {
      await reevaluateBookingActions(conversationId)
    } finally {
      // Task 11b: kartu CHANGE baru yang kelompoknya disetel ALWAYS diterapkan otomatis, lalu admin dikabari
      // (AUTO_APPLIED / push CHANGE bila tetap OPEN). Tidak pernah melempar.
      await autoApplyCreated(applied.changeEvents)
    }
    // Owner 2026-10-21: satu permintaan = SATU WhatsApp. Kartu yang tertulis/sudah sesuai sudah dijawab kabar
    // "sudah diperbarui"/"sudah sesuai"; tanda terima hanya untuk kartu yang masih OPEN (TASK, setelan APPROVE, gagal
    // tulis) supaya tamu tetap tahu permintaannya sampai. Tidak pernah melempar.
    await notifyGuestRequestReceived({ conversationId, bookingId: typeof booking.booking_id === 'number' || typeof booking.booking_id === 'string' ? String(booking.booking_id) : null, booking, cardIds: applied.cardIds })
    traceClose(run, 'selesai')
    reportAiActivity(
      'booking',
      'selesai',
      applied.cardIds.length > 0 ? `Memproses ${applied.cardIds.length} permintaan perubahan` : 'Tidak ada permintaan perubahan',
      conversationId,
      applied.cardIds.length > 0
    )
    return applied.cardIds.length > 0
  } catch (error) {
    console.error('[booking-actions] ekstraksi gagal', { conversationId, error: error instanceof Error ? error.message : 'unknown' })
    traceClose(run, 'gagal', { alasan: 'galat tak terduga' })
    if (extracting) reportAiActivity('booking', 'gagal', 'Gagal memproses permintaan', conversationId)
    return false
  }
}

// Test-only: membatalkan timer yang tertinggal antar kasus.
export function __resetBookingExtractionForTests(): void {
  for (const p of pending.values()) clearTimeout(p.timer)
  pending.clear()
}
