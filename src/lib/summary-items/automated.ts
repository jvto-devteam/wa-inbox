/**
 * Pesan keluar OTOMATIS yang bukan "balasan kita" untuk antrean /summary (review 2026-10-20, Important 1).
 *
 * Kabar "booking sudah diperbarui" ke tamu (`booking-actions/guest-notice.ts`) dan pesan permintaan data H-7
 * (`booking-actions/data-requests.ts`) adalah teks yang dirakit kode, terkirim beberapa detik sesudah pesan tamu.
 * Kalau dihitung balasan, "ganti kaos jadi L, dan bisa tambah Ijen?" tidak pernah jadi kandidat REPLY dan REPLY yang
 * terbuka tertutup REPLIED -- paling parah saat bot mati. Permintaan data tidak menjawab pertanyaan tamu walau
 * dikirim lewat tombol "Kirim" oleh orang (isinya draf kode), jadi keduanya selalu dikecualikan.
 *
 * Penandanya `botTrace.source` yang ditulis pengirimnya. Penyaringan dilakukan di JS, bukan filter JSON Prisma:
 * `NOT { botTrace: { path, equals } }` bernilai NULL untuk botTrace kosong/tanpa `source` di PostgreSQL, sehingga
 * diam-diam ikut membuang balasan sungguhan.
 */
import { prisma } from '@/lib/db'

export const BOOKING_UPDATE_NOTICE_SOURCE = 'booking_update_notice'
export const DATA_REQUEST_SOURCE = 'data_request'
const AUTOMATED_SOURCES: readonly string[] = [BOOKING_UPDATE_NOTICE_SOURCE, DATA_REQUEST_SOURCE]
/** Batas pesan otomatis berturut-turut yang dilompati saat mencari balasan sungguhan. */
const MAX_SKIPPED = 10

export function isAutomatedNotice(m: { direction: string; botTrace?: unknown }): boolean {
  if (m.direction !== 'OUTBOUND') return false
  const trace = m.botTrace
  if (typeof trace !== 'object' || trace === null || Array.isArray(trace)) return false
  const source = (trace as Record<string, unknown>).source
  return typeof source === 'string' && AUTOMATED_SOURCES.includes(source)
}

type Range = { gt?: Date; lt?: Date; lte?: Date }

/**
 * Pesan keluar sungguhan (bukan `isAutomatedNotice`) pertama (`asc`) atau terakhir (`desc`) dalam `range`.
 * `findFirst` berulang yang menggeser batas melewati pesan otomatis; null bila tidak ada.
 */
export async function findOurReply(
  conversationId: string,
  range: Range,
  order: 'asc' | 'desc'
): Promise<{ id: string; createdAt: Date } | null> {
  let bound: Range = range
  for (let i = 0; i <= MAX_SKIPPED; i++) {
    const m = await prisma.message.findFirst({
      where: { conversationId, direction: 'OUTBOUND', ...(Object.keys(bound).length > 0 ? { createdAt: bound } : {}) },
      orderBy: { createdAt: order },
      select: { id: true, createdAt: true, botTrace: true },
    })
    if (!m) return null
    if (!isAutomatedNotice({ direction: 'OUTBOUND', botTrace: m.botTrace })) return { id: m.id, createdAt: m.createdAt }
    bound = order === 'asc' ? { ...bound, gt: m.createdAt } : { ...bound, lt: m.createdAt }
  }
  return null
}
