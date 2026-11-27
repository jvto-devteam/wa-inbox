/**
 * Web Push untuk antrean tindakan (owner 2026-11-27: notif HP untuk reminder, pesan belum dibalas, follow up, janji
 * admin, komplain/masalah; dikirim 24 jam). Reminder ada di `reminders.ts`, komplain/masalah di `problems.ts`.
 *
 * Dipanggil tick 5 menit (`POST /api/summary-items/tick`) sesudah `createLiveReplyItems`:
 * - `pushNewQueueItems`: item REPLY (Balas, lahir sesudah 30 menit belum dibalas) dan PROMISE (Janji Admin) yang OPEN
 *   dan belum dikabarkan untuk anchor-nya -- satu push per item. Penanda `SummaryItem.pushedFor` = anchorAt yang sudah
 *   dikabarkan (klaim bersyarat, tick tumpang tindih/restart tidak mengirim dua kali); item yang dibuka ulang dengan
 *   anchor baru dikabarkan lagi. REPLY yang masih OPEN diingatkan ulang tiap `REPEAT_EVERY_MS` (1 jam) sejak push
 *   terakhir, maks. `MAX_REPEATS` (3) ulangan = 4 notif per anchor (owner 2026-11-27); `pushCount`/`pushedAt` di baris
 *   yang sama, tag sama sehingga ulangan menggantikan notif lama di HP. Baris lama (pushCount 0) tidak diulang.
 *   Lebih dari `MAX_SINGLE_PER_TICK` sekaligus = sisanya digabung jadi satu push.
 * - `pushFollowUpDigest`: FOLLOW_UP lahir di sync malam 00:00, jadi tidak di-push satu per satu tengah malam; mulai
 *   pukul 08:00 WIB satu push merangkum yang baru.
 *
 * Isi push: nama kontak (seperti push reminder, keputusan owner 2026-11-26), TANPA teks pesan pelanggan; nomor HP/email
 * disaring `scrub`. Ketuk = chat itu (pesan anchor bila ada). Tidak pernah melempar.
 */
import { prisma } from '@/lib/db'
import { scrub, sendPushToAll, type PushPayload } from './send'

export const MAX_SINGLE_PER_TICK = 5
export const REPEAT_EVERY_MS = 60 * 60 * 1000
export const MAX_REPEATS = 3
export const FOLLOW_UP_DIGEST_HOUR_WIB = 8
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000 // Asia/Jakarta, tanpa DST
const MAX_NAME = 60

type QueueKind = 'REPLY' | 'PROMISE'

function displayName(name: string | null | undefined): string | null {
  const n = name?.trim() ? scrub(name.trim()) : ''
  if (!n) return null
  return n.length > MAX_NAME ? `${n.slice(0, MAX_NAME - 1)}…` : n
}

function wibClock(d: Date): string {
  const w = new Date(d.getTime() + WIB_OFFSET_MS)
  return `${String(w.getUTCHours()).padStart(2, '0')}.${String(w.getUTCMinutes()).padStart(2, '0')}`
}

export function buildQueueItemPayload(i: {
  id: string
  kind: QueueKind
  conversationId: string
  anchorAt: Date
  anchorMessageId: string | null
  contactName: string | null
  /** 0 = notif pertama; 1..MAX_REPEATS = pengingat ulang ke-n. */
  repeat?: number
  now?: Date
}): PushPayload {
  const name = displayName(i.contactName) ?? 'Pelanggan'
  const params = new URLSearchParams({ conversation: i.conversationId })
  if (i.anchorMessageId) params.set('message', i.anchorMessageId)
  if (i.kind === 'REPLY' && i.repeat) {
    const hours = Math.max(1, Math.floor(((i.now ?? new Date()).getTime() - i.anchorAt.getTime()) / REPEAT_EVERY_MS))
    return {
      title: `Masih belum dibalas: ${name}`,
      body: `Menunggu sejak ${wibClock(i.anchorAt)} WIB (± ${hours} jam) · pengingat ${i.repeat}/${MAX_REPEATS} — ketuk untuk membalas`,
      url: `/inbox?${params}`,
      tag: `summary-item:${i.id}`,
    }
  }
  return i.kind === 'REPLY'
    ? { title: `Belum dibalas: ${name}`, body: `Menunggu balasan sejak ${wibClock(i.anchorAt)} WIB — ketuk untuk membalas`, url: `/inbox?${params}`, tag: `summary-item:${i.id}` }
    : { title: `Janji Admin: ${name}`, body: 'Ada janji ke tamu yang belum dipenuhi — ketuk untuk melihat', url: `/inbox?${params}`, tag: `summary-item:${i.id}` }
}

/**
 * Item OPEN berjenis `kinds` yang perlu dikabarkan, diklaim bersyarat: anchor belum dikabarkan (notif pertama,
 * pushCount = 1), atau -- hanya untuk `repeatKinds` -- sudah dikabarkan, masih OPEN, ≥ REPEAT_EVERY_MS sejak push
 * terakhir dan ulangan belum habis (pushCount + 1). `repeat` = nomor ulangan (0 = notif pertama).
 */
async function claimDue(kinds: string[], now: Date, repeatKinds: readonly string[] = []) {
  const open = await prisma.summaryItem.findMany({
    where: { state: 'OPEN', kind: { in: kinds } },
    orderBy: { anchorAt: 'asc' },
    select: {
      id: true, kind: true, conversationId: true, anchorAt: true, anchorMessageId: true, pushedFor: true, pushCount: true, pushedAt: true,
      conversation: { select: { contact: { select: { name: true } } } },
    },
  })
  const claimed: (typeof open[number] & { repeat: number })[] = []
  for (const r of open) {
    const fresh = r.pushedFor?.getTime() !== r.anchorAt.getTime()
    const repeatDue =
      !fresh && repeatKinds.includes(r.kind) && r.pushCount >= 1 && r.pushCount <= MAX_REPEATS && !!r.pushedAt && now.getTime() - r.pushedAt.getTime() >= REPEAT_EVERY_MS
    if (!fresh && !repeatDue) continue
    const where = fresh
      ? { id: r.id, state: 'OPEN', pushedFor: r.pushedFor, anchorAt: r.anchorAt }
      : { id: r.id, state: 'OPEN', pushedFor: r.pushedFor, anchorAt: r.anchorAt, pushCount: r.pushCount }
    const { count } = await prisma.summaryItem.updateMany({ where, data: { pushedFor: r.anchorAt, pushCount: fresh ? 1 : r.pushCount + 1, pushedAt: now } })
    if (count > 0) claimed.push({ ...r, repeat: fresh ? 0 : r.pushCount })
  }
  return claimed
}

export async function pushNewQueueItems(now: Date = new Date()): Promise<{ sent: number }> {
  let sent = 0
  try {
    const items = await claimDue(['REPLY', 'PROMISE'], now, ['REPLY'])
    for (const r of items.slice(0, MAX_SINGLE_PER_TICK)) {
      await sendPushToAll(buildQueueItemPayload({ ...r, kind: r.kind as QueueKind, contactName: r.conversation.contact.name, now }))
      sent++
    }
    const rest = items.slice(MAX_SINGLE_PER_TICK)
    if (rest.length > 0) {
      const replies = rest.filter((r) => r.kind === 'REPLY').length
      const promises = rest.length - replies
      const parts = [replies > 0 ? `${replies} belum dibalas` : null, promises > 0 ? `${promises} janji admin` : null].filter(Boolean)
      await sendPushToAll({ title: `${rest.length} chat lain di Antrean`, body: `${parts.join(' · ')} — ketuk untuk membuka Antrean`, url: '/antrean', tag: 'queue-batch' })
      sent++
    }
  } catch (error) {
    console.error('pushNewQueueItems gagal', { error: error instanceof Error ? error.message : 'unknown' })
  }
  return { sent }
}

export async function pushFollowUpDigest(now: Date = new Date()): Promise<{ sent: number }> {
  try {
    if (new Date(now.getTime() + WIB_OFFSET_MS).getUTCHours() < FOLLOW_UP_DIGEST_HOUR_WIB) return { sent: 0 }
    const fresh = await claimDue(['FOLLOW_UP'], now)
    if (fresh.length === 0) return { sent: 0 }
    const total = await prisma.summaryItem.count({ where: { state: 'OPEN', kind: 'FOLLOW_UP' } })
    await sendPushToAll({
      title: 'Follow up hari ini',
      body: `${fresh.length} chat perlu follow up${total > fresh.length ? ` (total ${total} terbuka)` : ''} — ketuk untuk membuka Antrean`,
      url: '/antrean',
      tag: 'follow-up-digest',
    })
    return { sent: 1 }
  } catch (error) {
    console.error('pushFollowUpDigest gagal', { error: error instanceof Error ? error.message : 'unknown' })
    return { sent: 0 }
  }
}
