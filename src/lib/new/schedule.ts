// Label jadwal reminder agent (salinan jadwal cron legacy, GET /api/new/agent-schedule), dipakai Antrean dan Dashboard.
import { jakartaDay } from '@/lib/bot/eval/replay-pairs'
import { addDays } from './report'
import type { AgentKey } from './types'

export const KIND_LABEL: Record<string, string> = {
  trip_information: 'Info trip', trip_concluded: 'Trip selesai', crew_reminder: 'Reminder crew',
  crew_trip_media: 'Foto trip ke grup crew', payment_reminder: 'Pelunasan', bali_transport: 'Transport Bali',
}

/** Agent yang mengirim tiap jenis jadwal (warna di linimasa Dashboard). */
export const SCHEDULE_AGENT: Record<string, AgentKey> = {
  trip_information: 'reminder', trip_concluded: 'reminder', payment_reminder: 'reminder',
  crew_reminder: 'crew', crew_trip_media: 'crew', bali_transport: 'vendor',
}

export const wibTime = (iso: string) => new Date(iso).toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

export function dayHead(iso: string, today: string): string {
  const d = jakartaDay(new Date(iso))
  if (d === today) return 'Hari ini'
  if (d === addDays(today, 1)) return 'Besok'
  if (d === addDays(today, -1)) return 'Kemarin'
  return new Date(iso).toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', weekday: 'long', day: 'numeric', month: 'short' })
}
