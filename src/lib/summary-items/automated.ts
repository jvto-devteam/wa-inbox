/**
 * Pesan keluar OTOMATIS yang bukan "balasan kita" untuk antrean /summary dan ringkasan chat (review 2026-10-20,
 * Important 1 + A).
 *
 * Kabar "booking sudah diperbarui" ke tamu (`booking-actions/guest-notice.ts`) dan pesan permintaan data H-7
 * (`booking-actions/data-requests.ts`) adalah teks yang dirakit kode, terkirim beberapa detik sesudah pesan tamu.
 * Kalau dihitung balasan, "ganti kaos jadi L, dan bisa tambah Ijen?" tidak pernah jadi kandidat REPLY dan REPLY yang
 * terbuka tertutup REPLIED -- paling parah saat bot mati. Permintaan data tidak menjawab pertanyaan tamu walau
 * dikirim lewat tombol "Kirim" oleh orang (isinya draf kode), jadi keduanya selalu dikecualikan.
 *
 * Penandanya `botTrace.source` yang ditulis pengirimnya. Pesan otomatis dicari dengan filter JSON POSITIF
 * (`path ['source'] equals ...`, aman terhadap NULL: botTrace kosong/tanpa `source` hanya tidak cocok) dan hanya `id`
 * yang diambil; pemanggil lalu mengecualikan per id. Filter NEGATIF (`NOT { path equals }`) sengaja tidak dipakai:
 * di PostgreSQL ia bernilai NULL untuk botTrace kosong sehingga diam-diam membuang balasan sungguhan. botTrace sendiri
 * (BotDecision, bisa beberapa KB) tidak pernah dimuat untuk keperluan ini (review Important B).
 */
import { prisma } from '@/lib/db'

export const BOOKING_UPDATE_NOTICE_SOURCE = 'booking_update_notice'
export const DATA_REQUEST_SOURCE = 'data_request'
const AUTOMATED_SOURCES = [BOOKING_UPDATE_NOTICE_SOURCE, DATA_REQUEST_SOURCE] as const

/**
 * Id pesan otomatis (OUTBOUND, `botTrace.source` di atas) di percakapan `conversationIds`, opsional sejak `since`.
 * Satu kueri, hanya `id`. Daftar kosong = tanpa kueri.
 */
export async function automatedMessageIds(conversationIds: readonly string[], since?: Date): Promise<Set<string>> {
  if (conversationIds.length === 0) return new Set()
  const rows =
    (await prisma.message.findMany({
      where: {
        conversationId: { in: [...conversationIds] },
        direction: 'OUTBOUND',
        ...(since ? { createdAt: { gte: since } } : {}),
        OR: AUTOMATED_SOURCES.map((source) => ({ botTrace: { path: ['source'], equals: source } })),
      },
      select: { id: true },
    })) ?? []
  return new Set(rows.map((r) => r.id))
}

type Range = { gt?: Date; lte?: Date }

/**
 * Pesan keluar sungguhan (bukan pesan otomatis) pertama (`asc`) atau terakhir (`desc`) dalam `range`; null bila
 * tidak ada. Dua kueri ringan: id pesan otomatis di rentang itu, lalu `findFirst` yang mengecualikannya.
 */
export async function findOurReply(
  conversationId: string,
  range: Range,
  order: 'asc' | 'desc'
): Promise<{ id: string; createdAt: Date } | null> {
  const skip = await automatedMessageIds([conversationId], range.gt)
  const hasRange = range.gt !== undefined || range.lte !== undefined
  return prisma.message.findFirst({
    where: {
      conversationId,
      direction: 'OUTBOUND',
      ...(hasRange ? { createdAt: range } : {}),
      ...(skip.size > 0 ? { id: { notIn: [...skip] } } : {}),
    },
    orderBy: { createdAt: order },
    select: { id: true, createdAt: true },
  })
}
