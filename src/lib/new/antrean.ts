// Menu Antrean /new: DATA ASLI. Item terbuka dari GET /api/summary-items (antrean yang sama dengan /summary),
// tab Reminder dari GET /api/new/reminders. Fungsi murni: bentuk tampilan per tab.
import type { SummaryItemsResponse } from '@/app/api/summary-items/route'
import type { NewReminder } from '@/app/api/new/reminders/route'
import type { AtKey } from './types'

export interface QueueItem {
  key: string
  /** Item antrean (Ingatkan/Lepas); null untuk reminder kontak tanpa item. */
  itemId: string | null
  reminder: NewReminder | null
  name: string
  conversationId: string | null
  href: string | null
  /** Label waktu di pill: lama menunggu, atau jatuh tempo reminder. */
  when: string
  overdue: boolean
  text: string
  saran: string | null
}

const KIND_TAB: Record<string, AtKey> = { REPLY: 'Balas', FOLLOW_UP: 'Tindak lanjut', PROMISE: 'Janji tim' }

export function chatHref(conversationId: string, messageId?: string | null): string {
  return '/inbox?conversation=' + encodeURIComponent(conversationId) + (messageId ? '&message=' + encodeURIComponent(messageId) : '')
}

/** "3 jam", "2 hari", "baru saja". */
export function ago(iso: string, now: Date): string {
  const min = Math.max(0, Math.floor((now.getTime() - Date.parse(iso)) / 60000))
  if (min < 60) return min < 2 ? 'baru saja' : min + ' menit'
  const h = Math.floor(min / 60)
  return h < 24 ? h + ' jam' : Math.floor(h / 24) + ' hari'
}

function wib(iso: string): string {
  return new Date(iso).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).replace(',', '')
}

export function buildQueue(items: SummaryItemsResponse | undefined, reminders: NewReminder[] | undefined, now: Date): Record<AtKey, QueueItem[]> {
  const out: Record<AtKey, QueueItem[]> = { Balas: [], 'Tindak lanjut': [], 'Janji tim': [], Reminder: [] }
  for (const it of items?.open ?? []) {
    const tab = KIND_TAB[it.kind]
    if (!tab) continue
    const since = ago(it.anchorAt, now)
    // OPEN dengan dueAt = pengingatnya sudah jatuh tempo dan item kembali ke antrean.
    const when = it.dueAt ? 'Pengingat jatuh tempo' : it.kind === 'REPLY' ? 'Menunggu ' + since : it.kind === 'FOLLOW_UP' ? 'Diam ' + since : 'Sejak ' + since
    const r = it.review
    out[tab].push({
      key: 'i:' + it.id,
      itemId: it.id,
      reminder: null,
      name: it.contactName || 'Tanpa nama',
      conversationId: it.conversationId,
      href: chatHref(it.conversationId, it.anchorMessageId),
      when,
      overdue: !!it.dueAt,
      text: it.snippet,
      saran: r?.langkahBerikut.trim() || r?.belumBooking?.rekomendasi.trim() || null,
    })
  }
  for (const rm of reminders ?? []) {
    const overdue = Date.parse(rm.dueAt) <= now.getTime()
    out.Reminder.push({
      key: 'r:' + rm.id,
      itemId: rm.summaryItemId,
      reminder: rm,
      name: rm.contactName || 'Tanpa nama',
      conversationId: rm.conversationId,
      href: rm.conversationId ? chatHref(rm.conversationId) : null,
      when: (overdue ? 'Lewat · ' : '') + wib(rm.dueAt),
      overdue,
      text: rm.note,
      saran: null,
    })
  }
  return out
}
