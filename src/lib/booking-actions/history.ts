/**
 * Riwayat tindakan booking: siapa/kapan/apa untuk setiap usulan, koreksi, eksekusi, dan
 * penolakan. Append-only; tabelnya sengaja tanpa FK supaya riwayat bertahan walau percakapan
 * dihapus.
 *
 * Perilaku gagal mengikuti `writeBotAuditLog`: dengan client transaksi `recordEvent` MELEMPAR
 * (pemanggil minta all-or-nothing -- tindakan tanpa jejak tidak boleh terjadi); standalone ia
 * menelan + log (kehilangan catatan lebih ringan daripada membatalkan tindakan yang sudah jalan).
 *
 * `reason` teks bebas, jadi lewat `sanitizeTrace` saat TULIS agar secret tidak mendarat di DB.
 */
import { Prisma, type PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { sanitizeTrace } from '@/lib/bot-control/trace-sanitizer'

export type BookingEventName =
  | 'CREATED'
  | 'CORRECTED'
  | 'EXECUTED'
  | 'EXECUTE_FAILED'
  | 'REJECTED'
  | 'SUPERSEDED'
  | 'RESOLVED'
  | 'DRAFT_SENT'
  | 'REVERTED'
  | 'VENDOR_NOTICE_FAILED'
  | 'GUEST_NOTICE_SENT'
  | 'GUEST_NOTICE_FAILED'
  | 'GUEST_NOTICE_SKIPPED'

export type BookingEventActor = 'BOT' | 'SYSTEM' | 'ACCOUNT'

export type BookingEventInput = {
  conversationId: string
  bookingId?: string | null
  actionId?: string | null
  event: BookingEventName
  actor: BookingEventActor
  accountId?: string | null
  oldValue?: Prisma.InputJsonValue | null
  newValue?: Prisma.InputJsonValue | null
  sourceMessageId?: string | null
  reason?: string | null
  /** Jawaban backoffice saat EXECUTED/EXECUTE_FAILED (tanpa secret). */
  backoffice?: Prisma.InputJsonValue | null
}

export type BookingEventWriter = Prisma.TransactionClient | PrismaClient

/** Nama + kode Prisma (mis. P2002) sebuah galat, tanpa pesan -- pesan Prisma bisa memuat isi argumen. */
function errorCode(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown'
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? `${error.name}:${code}` : error.name
}

/** Prisma membedakan JSON null dari kolom NULL; undefined/null di sini berarti kolom NULL. */
function json(value: Prisma.InputJsonValue | null | undefined): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return value ?? Prisma.DbNull
}

function cleanReason(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const trimmed = value.trim()
  if (trimmed.length === 0) return null
  return sanitizeTrace(trimmed) as string
}

export async function recordEvent(client: BookingEventWriter, e: BookingEventInput): Promise<void> {
  try {
    await client.bookingActionEvent.create({
      data: {
        conversationId: e.conversationId,
        bookingId: e.bookingId ?? null,
        actionId: e.actionId ?? null,
        event: e.event,
        actor: e.actor,
        accountId: e.accountId ?? null,
        oldValue: json(e.oldValue),
        newValue: json(e.newValue),
        sourceMessageId: e.sourceMessageId ?? null,
        reason: cleanReason(e.reason),
        backoffice: json(e.backoffice),
      },
    })
  } catch (error) {
    // Client bersama = standalone; selain itu client transaksi, dan kegagalan harus merambat.
    if (client !== prisma) throw error
    // Hanya nama/kode galat: pesan validasi Prisma bisa memuat argumen (nilai dari chat tamu).
    console.error('recordEvent gagal', { event: e.event, conversationId: e.conversationId, error: errorCode(error) })
  }
}
