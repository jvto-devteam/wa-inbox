/**
 * Web Push untuk antrean tindakan (owner 2026-11-27: notif HP untuk reminder, pesan belum dibalas, follow up, janji
 * admin, komplain/masalah; dikirim 24 jam). Reminder ada di `reminders.ts`, komplain/masalah di `problems.ts`.
 *
 * Dipanggil tick 5 menit (`POST /api/summary-items/tick`) sesudah `createLiveReplyItems`:
 * - `pushNewQueueItems`: item REPLY (Balas, lahir sesudah 30 menit belum dibalas) dan PROMISE (Janji Admin) yang OPEN
 *   dan belum dikabarkan untuk anchor-nya -- satu push per item. Penanda `SummaryItem.pushedFor` = anchorAt yang sudah
 *   dikabarkan (klaim bersyarat, tick tumpang tindih/restart tidak mengirim dua kali); item yang dibuka ulang dengan
 *   anchor baru dikabarkan lagi. Lebih dari `MAX_SINGLE_PER_TICK` sekaligus = sisanya digabung jadi satu push.
 * - `pushFollowUpDigest`: FOLLOW_UP lahir di sync malam 00:00, jadi tidak di-push satu per satu tengah malam; mulai
 *   pukul 08:00 WIB satu push merangkum yang baru.
 *
 * Isi push: nama kontak (seperti push reminder, keputusan owner 2026-11-26), TANPA teks pesan pelanggan; nomor HP/email
 * disaring `scrub`. Ketuk = chat itu (pesan anchor bila ada). Tidak pernah melempar.
 */
import { prisma } from '@/lib/db'
import { scrub, sendPushToAll, type PushPayload } from './send'

export const MAX_SINGLE_PER_TICK = 5
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
}): PushPayload {
  const name = displayName(i.contactName) ?? 'Pelanggan'
  const params = new URLSearchParams({ conversation: i.conversationId })
  if (i.anchorMessageId) params.set('message', i.anchorMessageId)
  return i.kind === 'REPLY'
    ? { title: `Belum dibalas: ${name}`, body: `Menunggu balasan sejak ${wibClock(i.anchorAt)} WIB — ketuk untuk membalas`, url: `/inbox?${params}`, tag: `summary-item:${i.id}` }
    : { title: `Janji Admin: ${name}`, body: 'Ada janji ke tamu yang belum dipenuhi — ketuk untuk melihat', url: `/inbox?${params}`, tag: `summary-item:${i.id}` }
}

/** Item OPEN berjenis `kinds` yang anchor-nya belum dikabarkan, diklaim (pushedFor = anchorAt). */
async function claimUnpushed(kinds: string[]) {
  const open = await prisma.summaryItem.findMany({
    where: { state: 'OPEN', kind: { in: kinds } },
    orderBy: { anchorAt: 'asc' },
    select: { id: true, kind: true, conversationId: true, anchorAt: true, anchorMessageId: true, pushedFor: true, conversation: { select: { contact: { select: { name: true } } } } },
  })
  const claimed: typeof open = []
  for (const r of open.filter((x) => x.pushedFor?.getTime() !== x.anchorAt.getTime())) {
    const { count } = await prisma.summaryItem.updateMany({ where: { id: r.id, state: 'OPEN', pushedFor: r.pushedFor, anchorAt: r.anchorAt }, data: { pushedFor: r.anchorAt } })
    if (count > 0) claimed.push(r)
  }
  return claimed
}

export async function pushNewQueueItems(): Promise<{ sent: number }> {
  let sent = 0
  try {
    const items = await claimUnpushed(['REPLY', 'PROMISE'])
    for (const r of items.slice(0, MAX_SINGLE_PER_TICK)) {
      await sendPushToAll(buildQueueItemPayload({ ...r, kind: r.kind as QueueKind, contactName: r.conversation.contact.name }))
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
    const fresh = await claimUnpushed(['FOLLOW_UP'])
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
