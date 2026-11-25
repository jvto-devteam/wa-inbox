// Percakapan yang TIDAK masuk antrean tindakan (owner 2026-11-25, dari isi Antrean /new):
// - selain WhatsApp (Instagram, Messenger, Email): antrean hanya untuk chat WhatsApp;
// - nomor Indonesia (gerbang yang sama dengan aksi booking: percakapan uji tetap lolos);
// - Belum dibalas yang rangkaian pesan pelanggannya TANPA ISI: reaksi, stiker, pesan dihapus/diedit, pesan yang tidak
//   didukung, lampiran Instagram story_mention/ig_post (owner 2026-11-25). Foto, dokumen, suara, video, lokasi, kontak
//   tetap isi (bisa bukti bayar/paspor);
// - Belum dibalas yang menurut ringkasan AI terbaru (sudah membaca pesan terakhir) tidak perlu dibalas (`perluBalas`
//   false); ringkasan yang belum membacanya / tanpa `perluBalas` = saringan kata seperti sebelumnya;
// - Follow Up / Janji tim untuk tamu yang TRIP-nya sudah selesai, kecuali review terbaru melihat potensi booking baru
//   (jenisKontak calon_tamu, atau ada `belumBooking`). Tamu yang trip-nya belum jalan tetap masuk. Tamu lama
//   (tamu_existing) yang datanya SUDAH dicek tapi tanpa booking aktif juga dihitung trip selesai: pencarian booking hanya
//   melihat trip sejak awal bulan lalu (booking/client.ts buildDateRange), jadi trip lama tidak punya bookingData;
// - percakapan uji (`isTest`) tidak masuk antrean;
// - kontak "lainnya" menurut AI (sales, salah sambung, uji coba): tidak masuk sama sekali; "mitra" (Klook, vendor,
//   hotel): tetap Balas/Janji, bukan Follow Up; Follow Up yang menurut AI percakapannya sudah "selesai" tidak masuk;
// - Follow Up yang ternyata TIM masih berutang (pertanyaan tamu belum dijawab, info dijanjikan belum dikirim, janji belum
//   ditepati) dipindah ke Janji tim, kecuali pesan agen terakhir meminta jawaban tamu (`followUpOwedByTeam`).
// Satu tempat untuk semuanya: dipakai `upsertCandidate` (tidak membuat/membuka item) dan `closeExcludedItems`
// (menutup item terbuka, closedReason NOT_QUEUED).
import { prisma } from '@/lib/db'
import { jakartaDay } from '@/lib/bot/eval/replay-pairs'
import { blockedByIndonesianGate } from '@/lib/booking-actions/rollout'
import { conversationReviewSchema } from '@/lib/daily-summary/payload-schema'
import { findOurReply } from './automated'

export type ExclusionReason =
  | 'BUKAN_WHATSAPP' | 'NOMOR_INDONESIA' | 'HANYA_REAKSI' | 'TIDAK_PERLU_BALAS' | 'TRIP_SELESAI'
  | 'BUKAN_TAMU' | 'MITRA_BUKAN_FOLLOW_UP' | 'PERCAKAPAN_SELESAI' | 'PERCAKAPAN_UJI' | 'PILIH_OPERATOR_LAIN' | 'TANGGAL_TRIP_LEWAT'

export const EXCLUSION_NOTE: Record<ExclusionReason, string> = {
  BUKAN_WHATSAPP: 'Bukan chat WhatsApp',
  NOMOR_INDONESIA: 'Nomor Indonesia',
  HANYA_REAKSI: 'Tanpa isi (reaksi, stiker, pesan dihapus, lampiran IG)',
  TIDAK_PERLU_BALAS: 'Menurut AI tidak perlu dibalas',
  TRIP_SELESAI: 'Trip sudah selesai',
  BUKAN_TAMU: 'Bukan tamu (sales, salah sambung, uji coba)',
  MITRA_BUKAN_FOLLOW_UP: 'Mitra: bukan follow-up lead',
  PERCAKAPAN_SELESAI: 'Menurut AI percakapan sudah selesai',
  PERCAKAPAN_UJI: 'Percakapan uji',
  PILIH_OPERATOR_LAIN: 'Tamu memilih operator lain / mencari open trip',
  TANGGAL_TRIP_LEWAT: 'Tanggal trip yang diminta sudah lewat',
}

/** Penanda (di `note` item OPEN) bahwa Janji tim ini pindahan dari Follow Up karena tim berutang; dibalik bila tidak lagi. */
export const OWED_NOTE = 'Pindahan Follow Up: tim masih berutang'
const OWED_BLOCKERS = new Set(['belum_dijawab', 'menunggu_tim'])

/** Apa yang masih diutang TIM menurut ringkasan: teks untuk kartu Janji, atau null. */
export function teamOwed(review: unknown): string | null {
  const r = (review ?? {}) as { belumBooking?: { alasan?: unknown; teks?: unknown }; janjiTim?: unknown }
  const unkept = Array.isArray(r.janjiTim)
    ? r.janjiTim.find((j): j is { teks: string } => !!j && typeof j === 'object' && (j as { terpenuhi?: unknown }).terpenuhi === false && typeof (j as { teks?: unknown }).teks === 'string')
    : undefined
  if (unkept) return unkept.teks
  const b = r.belumBooking
  return b && typeof b.alasan === 'string' && OWED_BLOCKERS.has(b.alasan) && typeof b.teks === 'string' ? b.teks : null
}

/** Jenis pesan masuk yang bukan isi (dipetakan dari pesan masuk produksi 2026-11-25). */
export const NON_CONTENT_TYPES = ['reaction', 'sticker', 'revoke', 'edit', 'unsupported', 'system'] as const
/** Placeholder teks lampiran Instagram/Messenger yang bukan isi (`[Lampiran: <jenis>]`, inbound-messenger.ts). */
export const NON_CONTENT_PLACEHOLDERS = ['[Lampiran: story_mention]', '[Lampiran: ig_post]', '[Lampiran: unsupported_type]'] as const

export function isNonContent(m: { type: string; content: string | null }): boolean {
  if ((NON_CONTENT_TYPES as readonly string[]).includes(m.type)) return true
  return (NON_CONTENT_PLACEHOLDERS as readonly string[]).includes(m.content?.trim() ?? '')
}

/** Filter Prisma: pesan yang ISI (kebalikan `isNonContent`), untuk kueri "pelanggan bicara lagi". */
export const CONTENT_MESSAGE_WHERE = {
  type: { notIn: [...NON_CONTENT_TYPES] },
  OR: [{ content: null }, { content: { notIn: [...NON_CONTENT_PLACEHOLDERS] } }],
}

/**
 * Hari terakhir trip mintaan dari ringkasan, tahunnya dibetulkan: transkrip tidak memuat tahun, jadi model kadang menulis
 * 2025/2024 untuk "22 December" (audit 2026-11-25: Villeval, Kevin, Félix tertutup keliru). Hanya tahun yang LEBIH LAMA dari
 * tahun percakapan yang dikoreksi: dijadikan tahun percakapan, lalu +1 bila masih sebelum percakapan dimulai. Tahun yang sama
 * dipercaya apa adanya (Pro Tech: "13 Nov 2026" ditulis tamu pada 17 Nov 2026 memang sudah lewat).
 */
export function tripEndDay(review: unknown, conversationCreatedAt: Date): string | null {
  return correctedDay((review as { tanggalTripSelesai?: unknown } | null)?.tanggalTripSelesai, conversationCreatedAt)
}

/** Hari pertama trip mintaan (`tanggalTripMulai`), tahunnya dibetulkan seperti `tripEndDay`. */
export function tripStartDay(review: unknown, conversationCreatedAt: Date): string | null {
  return correctedDay((review as { tanggalTripMulai?: unknown } | null)?.tanggalTripMulai, conversationCreatedAt)
}

function correctedDay(v: unknown, conversationCreatedAt: Date): string | null {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null
  const start = jakartaDay(conversationCreatedAt)
  const startYear = Number(start.slice(0, 4))
  const y = Number(v.slice(0, 4))
  if (y >= startYear) return v
  const md = v.slice(4)
  return `${startYear}${md}` < start ? `${startYear + 1}${md}` : `${startYear}${md}`
}

/** Trip sudah lewat: tanggal selesai booking (WIB) sebelum hari ini. */
export function tripEnded(bookingData: unknown, today: string): boolean {
  const end = (bookingData as { date?: { end_ymd?: unknown } } | null)?.date?.end_ymd
  return typeof end === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(end) && end < today
}

/** Review melihat calon booking baru (tamu lama yang menanyakan trip lain). */
export function potentialNewBooking(review: unknown): boolean {
  const r = conversationReviewSchema.pick({ jenisKontak: true }).safeParse(review)
  const blocker = (review as { belumBooking?: unknown } | null)?.belumBooking
  return (r.success && r.data.jenisKontak === 'calon_tamu') || Boolean(blocker)
}

/**
 * Rangkaian (urut waktu) tanpa isi: setiap pesan `isNonContent`, sesudah `revoke` membatalkan pesan BERISI terakhir
 * sebelumnya. Pesan `revoke` tidak menyimpan rujukan ke pesan yang dihapusnya (tidak ada kolomnya), jadi dipakai
 * kebiasaan tamu: yang ditarik adalah pesan terakhirnya ("kirim dokumen, 8 detik kemudian dihapus").
 */
export function contentlessRun(run: readonly { type: string; content: string | null }[]): boolean {
  if (!run.length) return false
  let content = 0
  for (const m of run) {
    if (m.type === 'revoke') content = Math.max(0, content - 1)
    else if (!isNonContent(m)) content++
  }
  return content === 0
}

/** Rangkaian pesan pelanggan sesudah balasan terakhir kita (urut waktu). */
async function unansweredRun(conversationId: string) {
  const lastOurs = await findOurReply(conversationId, {}, 'desc')
  return prisma.message.findMany({
    where: { conversationId, direction: 'INBOUND', ...(lastOurs ? { createdAt: { gt: lastOurs.createdAt } } : {}) },
    orderBy: { createdAt: 'asc' },
    select: { type: true, content: true, createdAt: true },
  })
}

/** Ringkasan terbaru sudah membaca pesan terakhir (dibuat SESUDAHNYA) dan menilai `perluBalas` false. */
export function reviewSaysNoReply(chatReview: unknown, chatReviewAt: Date | null, lastInboundAt: Date | undefined): boolean {
  if (!chatReviewAt || !lastInboundAt || !(lastInboundAt < chatReviewAt)) return false
  const r = conversationReviewSchema.pick({ perluBalas: true }).safeParse(chatReview)
  return r.success && r.data.perluBalas === false
}

/**
 * Ringkasan terbaru (dibuat SESUDAH pesan terakhir percakapan) menilai langkah berikutnya ada di tamu (`menungguTamu`):
 * rentetan pesan tim terakhir meminta jawaban/konfirmasi/data tamu. Penilaian makna oleh AI, bukan daftar kata (owner
 * 2026-11-25). Tanpa penilaian itu = tidak diketahui, item dibiarkan.
 */
export function reviewSaysAwaitingGuest(chatReview: unknown, chatReviewAt: Date | null, lastMessageAt: Date | undefined): boolean {
  if (!chatReviewAt || !lastMessageAt || !(lastMessageAt < chatReviewAt)) return false
  const r = conversationReviewSchema.pick({ menungguTamu: true }).safeParse(chatReview)
  return r.success && r.data.menungguTamu === true
}

/**
 * Janji tim yang sudah ditanggapi agen dengan permintaan jawaban ke tamu, dan tamu belum menjawab (`reviewSaysAwaitingGuest`):
 * bola di tamu, jadi itu Follow Up. Mengembalikan pesan agen terakhir sejak janji (jangkar Follow Up), atau null.
 */
export async function promiseAwaitingGuest(conversationId: string, promiseAt: Date) {
  const conv = await prisma.conversation.findUnique({ where: { id: conversationId }, select: { chatReview: true, chatReviewAt: true } })
  const last = await prisma.message.findFirst({ where: { conversationId }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } })
  if (!conv || !reviewSaysAwaitingGuest(conv.chatReview, conv.chatReviewAt, last?.createdAt)) return null
  return prisma.message.findFirst({
    where: { conversationId, direction: 'OUTBOUND', sentBy: 'AGENT', createdAt: { gte: promiseAt } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, createdAt: true, content: true, type: true, direction: true, sentBy: true },
  })
}

const clipSnippet = (t: string) => (t.trim().length > 200 ? t.trim().slice(0, 199) + '…' : t.trim())

/** Ubah item PROMISE terbuka jadi FOLLOW_UP berjangkar pertanyaan agen (lihat `promiseAwaitingGuest`). */
export async function promiseToFollowUp(itemId: string, question: { id: string; createdAt: Date; content: string | null }): Promise<void> {
  const snippet = (question.content ?? '').trim()
  // Pemanggil sudah memastikan item ini PROMISE yang OPEN.
  await prisma.summaryItem.update({
    where: { id: itemId },
    data: { kind: 'FOLLOW_UP', anchorAt: question.createdAt, anchorMessageId: question.id, snippet: snippet.length > 200 ? snippet.slice(0, 199) + '…' : snippet },
  })
}

/**
 * Alasan item `kind` untuk percakapan ini tidak masuk antrean, atau null. `review` = review kandidat/item; review
 * terbaru percakapan (`chatReview`) dipakai bila ada, karena ia yang paling tahu soal potensi booking baru.
 */
/**
 * Follow Up yang sebenarnya utang tim: ringkasan terbaru (`teamOwed`) dan pesan agen terakhir TIDAK meminta jawaban tamu.
 * Mengembalikan teks utangnya (untuk kartu Janji), atau null.
 */
export async function followUpOwedByTeam(conversationId: string): Promise<string | null> {
  const conv = await prisma.conversation.findUnique({ where: { id: conversationId }, select: { chatReview: true } })
  const owed = teamOwed(conv?.chatReview)
  if (!owed) return null
  return (await promiseAwaitingGuest(conversationId, new Date(0))) ? null : owed
}

export async function exclusionFor(conversationId: string, kind: string, review: unknown, now: Date = new Date()): Promise<ExclusionReason | null> {
  const conv = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: {
      isTest: true, createdAt: true, bookingData: true, bookingCheckedAt: true, chatReview: true, chatReviewAt: true, mailAccountId: true, channelIdentityId: true,
      channelIdentity: { select: { platform: true } }, contact: { select: { phone: true } },
    },
  })
  if (!conv) return null
  // WhatsApp = identitas WA, atau percakapan lama tanpa identitas yang bukan email (Instagram/Facebook selalu punya
  // identitas sendiri; sebelum ChannelIdentity ada, satu-satunya channel non-email adalah WhatsApp).
  const whatsapp = conv.channelIdentity ? conv.channelIdentity.platform === 'WHATSAPP' : !conv.mailAccountId
  if (!whatsapp) return 'BUKAN_WHATSAPP'
  if (conv.isTest) return 'PERCAKAPAN_UJI'
  if (blockedByIndonesianGate({ isTest: conv.isTest, phone: conv.contact?.phone ?? null })) return 'NOMOR_INDONESIA'
  const latest = (conv.chatReview ?? {}) as { jenisKontak?: unknown; status?: unknown; belumBooking?: { alasan?: unknown }; tanggalTripSelesai?: unknown; profil?: unknown }
  if (latest.jenisKontak === 'lainnya') return 'BUKAN_TAMU'
  if (kind === 'FOLLOW_UP' && latest.jenisKontak === 'mitra') return 'MITRA_BUKAN_FOLLOW_UP'
  if ((kind === 'FOLLOW_UP' || kind === 'PROMISE') && latest.status === 'selesai') return 'PERCAKAPAN_SELESAI'
  // Memilih operator lain, atau calon tamu tanpa booking yang mencari open trip (label profil `open_trip`): JVTO hanya
  // tur privat, jadi tidak ada yang bisa ditindaklanjuti (owner 2026-11-25, kasus Félix).
  const seeksOpenTrip = !conv.bookingData && Array.isArray(latest.profil) && latest.profil.some((p) => (p as { label?: unknown } | null)?.label === 'open_trip')
  if ((kind === 'FOLLOW_UP' || kind === 'PROMISE') && (latest.belumBooking?.alasan === 'pilih_lain' || seeksOpenTrip)) return 'PILIH_OPERATOR_LAIN'
  // Lead tanpa booking yang tanggal trip yang dimintanya sudah lewat: tidak ada lagi yang bisa ditindaklanjuti.
  if (kind === 'FOLLOW_UP' || kind === 'PROMISE') {
    // Hari MULAI menentukan (lead yang belum booking sampai trip mulai sudah tidak bisa dikejar); tanpa itu, hari selesai.
    const day = conv.bookingData ? null : (tripStartDay(conv.chatReview, conv.createdAt) ?? tripEndDay(conv.chatReview, conv.createdAt))
    if (day && day < jakartaDay(now)) return 'TANGGAL_TRIP_LEWAT'
  }
  if (kind === 'REPLY') {
    const run = await unansweredRun(conversationId)
    if (contentlessRun(run)) return 'HANYA_REAKSI'
    return reviewSaysNoReply(conv.chatReview, conv.chatReviewAt, run.at(-1)?.createdAt) ? 'TIDAK_PERLU_BALAS' : null
  }
  const pastGuest = latest.jenisKontak === 'tamu_existing' && !conv.bookingData && conv.bookingCheckedAt !== null
  if ((kind === 'FOLLOW_UP' || kind === 'PROMISE') && (tripEnded(conv.bookingData, jakartaDay(now)) || pastGuest)) {
    return potentialNewBooking(conv.chatReview ?? review) ? null : 'TRIP_SELESAI'
  }
  return null
}

/**
 * Menutup item OPEN yang kena aturan di atas (DONE, NOT_QUEUED, catatan = alasannya). Item SCHEDULED tidak disentuh:
 * pengingat adalah keputusan operator. Dipanggil di akhir `reconcileSummaryItems`, sesudah konversi jenis. Tidak
 * pernah melempar.
 */
export async function closeExcludedItems(now: Date = new Date()): Promise<number> {
  let closed = 0
  try {
    const items = await prisma.summaryItem.findMany({ where: { state: 'OPEN' }, select: { id: true, conversationId: true, kind: true, review: true, anchorAt: true, note: true } })
    for (const it of items) {
      let kind = it.kind
      if (kind === 'FOLLOW_UP') {
        const owed = await followUpOwedByTeam(it.conversationId).catch(() => null)
        if (owed) {
          await prisma.summaryItem.update({ where: { id: it.id }, data: { kind: 'PROMISE', snippet: clipSnippet(owed), note: OWED_NOTE } })
          kind = 'PROMISE'
        }
      } else if (kind === 'PROMISE' && it.note === OWED_NOTE && !(await followUpOwedByTeam(it.conversationId).catch(() => 'tetap'))) {
        // Utang tim sudah beres menurut ringkasan terbaru: kembali jadi Follow Up.
        await prisma.summaryItem.update({ where: { id: it.id }, data: { kind: 'FOLLOW_UP', note: null } })
        kind = 'FOLLOW_UP'
      }
      if (kind === 'PROMISE') {
        const question = await promiseAwaitingGuest(it.conversationId, it.anchorAt).catch(() => null)
        if (question) {
          await promiseToFollowUp(it.id, question)
          kind = 'FOLLOW_UP'
        }
      }
      const reason = await exclusionFor(it.conversationId, kind, it.review, now).catch(() => null)
      if (!reason) continue
      await prisma.summaryItem.updateMany({
        where: { id: it.id, state: 'OPEN' },
        data: { state: 'DONE', closedReason: 'NOT_QUEUED', note: EXCLUSION_NOTE[reason], closedAt: now },
      })
      closed++
    }
  } catch (error) {
    console.error('closeExcludedItems gagal', error instanceof Error ? error.name : 'unknown')
  }
  return closed
}
