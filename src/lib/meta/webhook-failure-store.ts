/**
 * Jaring pengaman webhook Meta: isi mentah webhook yang gagal diproses (`POST /api/webhooks/meta` menjawab 500) disimpan
 * di `WebhookFailure`, lalu tick 5 menit memprosesnya ulang. Pesan tidak bergantung pada Meta mengirim ulang -- yang
 * berhenti setelah beberapa hari -- dan pulih beberapa menit sesudah perbaikan tayang. Pemicunya 27 Nov 2026: pesan
 * WhatsApp tanpa nomor dijawab 500 berjam-jam dan tidak ada yang tersimpan.
 *
 * - Satu baris per isi unik (`bodyHash`, SHA-256): kiriman ulang Meta untuk isi yang sama tidak menggandakan.
 * - Pemrosesan ulang idempoten: `ingestMetaMessage` melewati pesan yang `externalId`-nya sudah ada.
 * - Dicoba lagi tiap `RETRY_EVERY_MS` selama `REPLAY_WINDOW_MS` (selaras jendela kirim ulang Meta); sesudahnya dibiarkan.
 * - Isinya memuat teks dan nomor pelanggan: dipangkas setelah `RETENTION_MS` (30 hari, sama dengan ringkasan chat).
 * - Tidak pernah melempar: gagal menyimpan/memproses tidak boleh mengubah jawaban webhook atau menggagalkan tick.
 */
import { createHash } from 'node:crypto'
import { prisma } from '@/lib/db'
import { ingestMetaMessage } from '@/lib/inbound'

export const RETRY_EVERY_MS = 15 * 60 * 1000
export const REPLAY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000
export const RETENTION_MS = 30 * 24 * 60 * 60 * 1000
export const REPLAY_PER_TICK = 20
const MAX_ERROR = 300

const errorText = (error: unknown): string => {
  const raw = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  // Pesan galat Prisma bisa memuat nilai: deret angka panjang dan email disamarkan, dan hanya awalnya yang disimpan.
  return raw.replace(/[^\s@]+@[^\s@]+/g, '…').replace(/\d{6,}/g, '…').slice(0, MAX_ERROR)
}

export async function saveWebhookFailure(rawBody: string, error: unknown): Promise<void> {
  try {
    const bodyHash = createHash('sha256').update(rawBody).digest('hex')
    await prisma.webhookFailure.upsert({
      where: { bodyHash },
      create: { bodyHash, body: rawBody, error: errorText(error) },
      update: { error: errorText(error) },
    })
  } catch {
    console.error('saveWebhookFailure gagal')
  }
}

export async function replayWebhookFailures(now: Date = new Date()): Promise<{ replayed: number; failed: number; pruned: number }> {
  const result = { replayed: 0, failed: 0, pruned: 0 }
  try {
    const due = await prisma.webhookFailure.findMany({
      where: {
        processedAt: null,
        createdAt: { gte: new Date(now.getTime() - REPLAY_WINDOW_MS) },
        OR: [{ lastAttemptAt: null }, { lastAttemptAt: { lte: new Date(now.getTime() - RETRY_EVERY_MS) } }],
      },
      orderBy: { createdAt: 'asc' },
      take: REPLAY_PER_TICK,
    })
    for (const row of due) {
      try {
        await ingestMetaMessage(JSON.parse(row.body))
        await prisma.webhookFailure.update({ where: { id: row.id }, data: { processedAt: now, lastAttemptAt: now, attempts: { increment: 1 } } })
        result.replayed++
      } catch (error) {
        await prisma.webhookFailure.update({ where: { id: row.id }, data: { lastAttemptAt: now, attempts: { increment: 1 }, error: errorText(error) } }).catch(() => undefined)
        result.failed++
      }
    }
    const pruned = await prisma.webhookFailure.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - RETENTION_MS) } } })
    result.pruned = pruned.count
  } catch {
    console.error('replayWebhookFailures gagal')
  }
  return result
}
