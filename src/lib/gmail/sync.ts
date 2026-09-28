import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import {
  getAccessToken, invalidateAccessToken, gmailGetMessage, gmailGetProfile,
  gmailListHistory, gmailListMessageIds, gmailWatch,
} from './client'
import { GmailError } from './errors'
import { ingestGmailMessage } from './ingest'

/**
 * Tarik email baru satu kotak surat, sejak kursor terakhir.
 *
 * Dua pemanggil, satu fungsi: bel pintu Pub/Sub (POST /api/webhooks/gmail) dan cron 15 menit
 * (POST /api/email/sync). Cron BUKAN sekadar cadangan -- ia yang memperpanjang watch(), yang
 * kedaluwarsa tiap 7 hari dan kalau gagal diperpanjang email berhenti masuk TANPA error apa
 * pun (spec §6.3). Tarikan berkala membuat watch yang telanjur mati sembuh sendiri.
 */
export type MailSyncError = 'AUTH_REVOKED' | 'GMAIL_HTTP' | 'INGEST_FAILED' | 'WATCH_FAILED'

export interface SyncResult {
  accountId: string
  emailAddress: string
  ingested: number
  skipped: number
  error: MailSyncError | null
}

/** Keputusan D3: pemulihan kursor kedaluwarsa menarik 7 hari, tidak lebih. */
const RECOVERY_QUERY = 'newer_than:7d -in:spam -in:trash -in:drafts'
const WATCH_RENEW_MARGIN_MS = 24 * 60 * 60 * 1000

async function collectNewMessageIds(token: string, historyId: string | null): Promise<{ messageIds: string[]; nextHistoryId: string }> {
  if (historyId === null) {
    const profile = await gmailGetProfile(token)
    return { messageIds: [], nextHistoryId: profile.historyId }
  }
  try {
    const ids = new Set<string>()
    let latest = historyId
    let pageToken: string | undefined
    do {
      const page = await gmailListHistory(token, historyId, pageToken)
      for (const entry of page.history ?? []) {
        for (const added of entry.messagesAdded ?? []) ids.add(added.message.id)
      }
      if (page.historyId) latest = page.historyId
      pageToken = page.nextPageToken
    } while (pageToken)
    return { messageIds: [...ids], nextHistoryId: latest }
  } catch (error) {
    if (!(error instanceof GmailError && error.kind === 'HISTORY_EXPIRED')) throw error
    // Kursor profil diambil SEBELUM daftar pemulihan: email yang tiba di antara keduanya lalu
    // tercakup dua kali (aman, externalId @unique), bukan nol kali.
    const profile = await gmailGetProfile(token)
    const messageIds = await gmailListMessageIds(token, RECOVERY_QUERY)
    return { messageIds, nextHistoryId: profile.historyId }
  }
}

/**
 * Hanya MAJU, dan hanya kalau tidak ada yang mendahului: `where historyId = nilai lama`
 * membuat dua sinkronisasi yang balapan tidak bisa saling memundurkan kursor.
 */
async function advanceHistoryId(accountId: string, current: string | null, next: string): Promise<void> {
  if (current !== null && BigInt(next) <= BigInt(current)) return
  await prisma.mailAccount.updateMany({ where: { id: accountId, historyId: current }, data: { historyId: next } })
}

async function renewWatchIfDue(
  token: string,
  account: { id: string; watchExpiresAt: Date | null },
  now: Date,
): Promise<MailSyncError | null> {
  const topic = process.env.GMAIL_PUBSUB_TOPIC
  // Tanpa topik: mode tarik-saja (cron 15 menit). Panel menampilkan "push mati", jadi ini
  // bukan kegagalan diam.
  if (!topic) return null
  if (account.watchExpiresAt && account.watchExpiresAt.getTime() - now.getTime() > WATCH_RENEW_MARGIN_MS) return null
  try {
    const watch = await gmailWatch(token, topic)
    await prisma.mailAccount.update({ where: { id: account.id }, data: { watchExpiresAt: new Date(Number(watch.expiration)) } })
    return null
  } catch (error) {
    console.error('syncMailAccount: perpanjangan watch gagal', { accountId: account.id, kind: error instanceof GmailError ? error.kind : 'unknown' })
    return 'WATCH_FAILED'
  }
}

export async function syncMailAccount(accountId: string, now: Date = new Date()): Promise<SyncResult> {
  const account = await prisma.mailAccount.findUniqueOrThrow({ where: { id: accountId } })
  const result: SyncResult = { accountId, emailAddress: account.emailAddress, ingested: 0, skipped: 0, error: null }

  try {
    const token = await getAccessToken(account)
    const { messageIds, nextHistoryId } = await collectNewMessageIds(token, account.historyId)

    let failed = false
    for (const id of messageIds) {
      try {
        const message = await gmailGetMessage(token, id)
        if (!message) {
          result.skipped += 1
          continue
        }
        const outcome = await ingestGmailMessage(account, message)
        if (outcome === 'created') result.ingested += 1
        else result.skipped += 1
      } catch (error) {
        failed = true
        // `name` dan (kalau Prisma) `code` ikut dicatat supaya sebab bisa dilacak tanpa
        // membuka `message` -- ini yang membedakan error 22021 (byte NUL, lihat stripNulByte
        // di ingest.ts) dari kegagalan Gmail HTTP lainnya tanpa pernah mencetak isi email.
        console.error('syncMailAccount: satu email gagal diproses', {
          accountId,
          gmailMessageId: id,
          kind: error instanceof GmailError ? error.kind : 'unknown',
          name: error instanceof Error ? error.name : 'unknown',
          ...(error instanceof Prisma.PrismaClientKnownRequestError ? { code: error.code } : {}),
        })
      }
    }

    // Kursor tidak dimajukan melewati email yang gagal: putaran berikutnya mengambilnya lagi,
    // dan yang sudah berhasil ditahan externalId @unique.
    if (failed) result.error = 'INGEST_FAILED'
    else await advanceHistoryId(account.id, account.historyId, nextHistoryId)

    // Diperpanjang setiap kali history.list DI ATAS berhasil diambil -- termasuk saat ada
    // email yang gagal diproses satu per satu: satu email rusak tidak boleh ikut mematikan
    // push untuk email berikutnya. Kalau history.list SENDIRI yang gagal, baris ini tidak
    // pernah tercapai (dilempar ke catch di bawah, hasilnya GMAIL_HTTP/AUTH_REVOKED, bukan
    // WATCH_FAILED) -- "SELALU" di komentar lama ini menyesatkan.
    const watchError = await renewWatchIfDue(token, account, now)
    result.error = result.error ?? watchError
  } catch (error) {
    if (error instanceof GmailError && error.kind === 'UNAUTHORIZED') invalidateAccessToken(accountId)
    result.error = error instanceof GmailError && error.kind === 'AUTH_REVOKED' ? 'AUTH_REVOKED' : 'GMAIL_HTTP'
    console.error('syncMailAccount: sinkronisasi gagal', { accountId, kind: error instanceof GmailError ? error.kind : 'unknown' })
  }

  await prisma.mailAccount.update({
    where: { id: accountId },
    data: result.error === null ? { lastSyncAt: now, lastSyncError: null } : { lastSyncError: result.error },
  })
  return result
}

const running = new Map<string, Promise<SyncResult>>()
const rerunRequested = new Set<string>()

/**
 * Satu sinkronisasi per kotak surat pada satu waktu. Bel yang berbunyi saat sinkronisasi
 * berjalan tidak diabaikan -- email pemicunya bisa tiba SETELAH history.list putaran ini
 * dibaca -- tapi juga tidak menumpuk: semua bel di tengah putaran dilebur jadi satu ulangan.
 */
export function requestSync(accountId: string): Promise<SyncResult> {
  const current = running.get(accountId)
  if (current) {
    rerunRequested.add(accountId)
    return current
  }
  const run = (async () => {
    try {
      let result = await syncMailAccount(accountId)
      while (rerunRequested.delete(accountId)) result = await syncMailAccount(accountId)
      return result
    } finally {
      running.delete(accountId)
      // `syncMailAccount` di atas bisa melempar SEBELUM baris `while` mana pun tercapai
      // (misalnya `findUniqueOrThrow` yang gagal). Tanpa baris ini, bel yang berbunyi
      // SELAGI upaya itu berjalan meninggalkan penanda rerun basi -- percobaan bersih
      // berikutnya untuk akun yang sama diam-diam mengulang sinkronisasi satu kali ekstra
      // yang tidak pernah diminta siapa pun.
      rerunRequested.delete(accountId)
    }
  })()
  running.set(accountId, run)
  return run
}

export async function syncAllMailAccounts(): Promise<SyncResult[]> {
  const accounts = await prisma.mailAccount.findMany({ select: { id: true, emailAddress: true }, orderBy: { createdAt: 'asc' } })
  const results: SyncResult[] = []
  // Berurutan, bukan paralel: kotak surat JVTO hanya dua, dan sinkronisasi berurutan tidak
  // pernah berebut CPU dengan balasan WhatsApp yang sedang ditunggu pelanggan.
  for (const account of accounts) {
    try {
      results.push(await requestSync(account.id))
    } catch (error) {
      // `requestSync`/`syncMailAccount` bisa melempar SEBELUM sempat membangun SyncResult
      // sendiri (misalnya `findUniqueOrThrow` gagal karena akunnya baru saja dihapus).
      // Tanpa try/catch di sini, satu kotak surat yang bernasib begitu menghentikan
      // `for` dan kotak surat berikutnya di daftar tidak pernah disinkronkan sama sekali.
      console.error('syncAllMailAccounts: satu kotak surat gagal disinkronkan', {
        accountId: account.id, name: error instanceof Error ? error.name : 'unknown',
      })
      results.push({ accountId: account.id, emailAddress: account.emailAddress, ingested: 0, skipped: 0, error: 'GMAIL_HTTP' })
    }
  }
  return results
}

export function __resetSyncStateForTests(): void {
  running.clear()
  rerunRequested.clear()
}
