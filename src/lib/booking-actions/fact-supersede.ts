/**
 * Fakta lama yang sudah dilewati sebuah permintaan perubahan (final review Important 5).
 *
 * Tamu menyebut "jemput 10:30" (fakta, pesan #2) lalu meminta "jemput jam 9 saja" (CHANGE, pesan #5). Begitu
 * CHANGE itu dibuat -- dan lagi saat ia dieksekusi -- fakta 10:30 sudah usang. Kalau dibiarkan aktif, booking yang
 * kini 09:00 dibandingkan dengan fakta 10:30 dan memunculkan MISMATCH palsu. Fungsi ini menstempel `supersededAt`
 * fakta aktif field itu yang pesan sumbernya LEBIH TUA ATAU SAMA dengan pesan sumber perubahan (pesan yang sama =
 * pernyataan yang sama; permintaan eksplisitnya yang berlaku). Untuk perubahan TITIK, fakta detail/kedatangan sisi
 * yang sama yang LEBIH TUA ikut usang (titik baru membawa detail baru); yang dari pesan yang sama adalah detail titik baru
 * itu dan tetap hidup.
 *
 * Tidak pernah menebak: fakta tanpa pesan sumber atau dengan waktu pesan yang tak diketahui dibiarkan.
 */
import type { Prisma, PrismaClient } from '@prisma/client'

type Db = Prisma.TransactionClient | PrismaClient

/** Field fakta yang dilewati perubahan pada `field`. */
export function supersededFactFields(field: string): string[] {
  if (field === 'pickup_point') return ['pickup_point', 'pickup_detail', 'pickup_arrival']
  if (field === 'drop_point') return ['drop_point', 'drop_detail', 'drop_arrival']
  return [field]
}

export async function supersedeOlderFacts(
  db: Db,
  input: { conversationId: string; bookingId: string | null; field: string; sourceMessageId: string | null; now: Date }
): Promise<number> {
  const { conversationId, bookingId, sourceMessageId, now } = input
  if (sourceMessageId === null) return 0
  const fields = supersededFactFields(input.field)
  const facts = ((await db.bookingFact.findMany({
    where: { conversationId, supersededAt: null, field: { in: fields } },
    select: { id: true, bookingId: true, sourceMessageId: true, field: true },
  })) ?? []).filter((f) => f.bookingId === null || f.bookingId === bookingId)
  if (facts.length === 0) return 0

  const ids = [sourceMessageId, ...facts.map((f) => f.sourceMessageId).filter((id): id is string => id !== null)]
  const rows = (await db.message.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, createdAt: true } })) ?? []
  const time = new Map(rows.map((r) => [r.id, r.createdAt.getTime()]))
  const cutoff = time.get(sourceMessageId)
  if (cutoff === undefined) return 0

  let count = 0
  for (const f of facts) {
    const t = f.sourceMessageId === null ? undefined : time.get(f.sourceMessageId)
    // Detail/kedatangan pendamping titik dari pesan YANG SAMA adalah detail titik baru itu ("drop di bandara, flight
    // ABC123"), bukan detail lama: hanya yang lebih tua yang usang (uji owner 2026-10-21).
    if (t === undefined || t > cutoff || (f.field !== input.field && t === cutoff)) continue
    await db.bookingFact.update({ where: { id: f.id }, data: { supersededAt: now } })
    count++
  }
  return count
}
