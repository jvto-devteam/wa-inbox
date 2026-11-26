/**
 * Web Push untuk reminder yang jatuh tempo (owner 2026-11-26: "bukan cuma teks reminder aja, tapi beneran ada notifnya").
 *
 * Dipanggil tick 5 menit (`POST /api/summary-items/tick`). Mencakup semua reminder kontak: yang dibuat lewat Ingatkan di
 * Antrean/Ringkasan (item SCHEDULED) maupun dari Laporan dan halaman Kontak. Satu push per jatuh tempo: kolom
 * `Reminder.pushedFor` menyimpan dueAt yang sudah dikabarkan, jadi reminder yang ditunda (dueAt baru) dikabarkan lagi.
 *
 * Isi (keputusan owner 2026-11-26): nama kontak + catatan reminder, nomor HP/email disaring (`scrub`). Ketuk = chat
 * terbaru kontak itu, atau Antrean bila kontak tanpa percakapan.
 *
 * Reminder yang jatuh temponya sudah lewat lebih dari `MAX_LATE_MS` tidak di-push (mis. tumpukan lama saat fitur ini
 * pertama tayang): ia tetap terlihat sebagai "Lewat" di tab Reminder. Tidak pernah melempar.
 */
import { prisma } from '@/lib/db'
import { scrub, sendPushToAll, type PushPayload } from './send'

export const MAX_LATE_MS = 24 * 60 * 60 * 1000
const MAX_NOTE = 140
const MAX_PER_TICK = 50

export function buildReminderPayload(r: { id: string; note: string; contactName: string | null; conversationId: string | null }): PushPayload {
  const note = scrub(r.note.trim()) || 'Pengingat jatuh tempo'
  const name = r.contactName?.trim() ? scrub(r.contactName.trim()) : null
  return {
    title: name ? `Pengingat: ${name}` : 'Pengingat jatuh tempo',
    body: note.length > MAX_NOTE ? `${note.slice(0, MAX_NOTE - 1)}…` : note,
    url: r.conversationId ? `/inbox?conversation=${encodeURIComponent(r.conversationId)}` : '/antrean',
    tag: `reminder:${r.id}`,
  }
}

export async function pushDueReminders(now: Date = new Date()): Promise<{ sent: number }> {
  let sent = 0
  try {
    const due = await prisma.reminder.findMany({
      where: { done: false, dueAt: { lte: now, gte: new Date(now.getTime() - MAX_LATE_MS) } },
      orderBy: { dueAt: 'asc' },
      take: MAX_PER_TICK * 2,
      select: {
        id: true, note: true, dueAt: true, pushedFor: true,
        contact: { select: { name: true, conversations: { select: { id: true }, orderBy: { lastMessageAt: 'desc' }, take: 1 } } },
      },
    })
    for (const r of due.filter((x) => x.pushedFor?.getTime() !== x.dueAt.getTime()).slice(0, MAX_PER_TICK)) {
      // Klaim dulu (bersyarat pada nilai lama): tick yang tumpang tindih atau restart tidak mengirim dua kali.
      const claimed = await prisma.reminder.updateMany({ where: { id: r.id, pushedFor: r.pushedFor, dueAt: r.dueAt }, data: { pushedFor: r.dueAt } })
      if (claimed.count === 0) continue
      await sendPushToAll(buildReminderPayload({ id: r.id, note: r.note, contactName: r.contact.name, conversationId: r.contact.conversations[0]?.id ?? null }))
      sent++
    }
  } catch (error) {
    console.error('pushDueReminders gagal', { error: error instanceof Error ? error.message : 'unknown' })
  }
  return { sent }
}
