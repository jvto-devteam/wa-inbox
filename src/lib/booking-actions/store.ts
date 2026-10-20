/**
 * Penyimpanan tindakan booking dari chat + evaluasi ulang terhadap `bookingData` terbaru.
 *
 * Tidak pernah memanggil LLM: `applyExtraction` menerima Extraction yang sudah jadi, dan
 * `reevaluateBookingActions` hanya membandingkan data (compare.ts). Satu transaksi per
 * pemanggilan; setiap transisi menulis tepat SATU BookingActionEvent lewat client transaksi
 * (melempar bila gagal, jadi tindakan tanpa jejak tidak mungkin).
 *
 * Aturan transisi:
 *   - Usulan (changes): kelompok AI/BALI -> CHANGE, HEAVY -> TASK. Usulan OPEN untuk field
 *     yang sama dengan nilai sama = tidak ada apa-apa; nilai beda -> yang lama SUPERSEDED/REPLACED.
 *   - Fakta baru untuk field yang sama menstempel `supersededAt` fakta lama.
 *   - CHANGE/TASK OPEN yang sudah sesuai di backoffice -> RESOLVED/MATCHED_IN_BACKOFFICE.
 *   - MISMATCH (booking terisi, chat beda) OPEN; hilang dari findMismatches -> RESOLVED.
 *   - Booking KOSONG + tamu menyebut nilai (Ruling R8): kelompok AI/BALI -> CHANGE "isi data";
 *     HEAVY -> diabaikan.
 *   - Terbaru menang: untuk field yang sama, usulan dari pesan sumber yang lebih baru menggantikan
 *     yang lebih lama (fakta maupun permintaan eksplisit). Keluaran satu ekstraksi lebih dulu diringkas
 *     per field ke pesan sumber TERBARU (urutan keluaran LLM tidak berarti apa-apa).
 *   - Batas air (final review Important 2): ekstraksi membaca ulang 20 pesan terakhir setiap kali, jadi pesan
 *     lama terbaca lagi. Usulan yang pesan sumbernya lebih tua atau sama dengan pesan sumber CHANGE/TASK
 *     NON-OPEN mana pun untuk field itu (dieksekusi, ditolak, digantikan, cocok di backoffice, ...) dilewati --
 *     tanpa ini nilai yang sudah dilewati hidup lagi dan, dengan ALWAYS, membalik booking bolak-balik. Fakta:
 *     dilewati bila pesannya lebih tua atau sama dengan fakta mana pun (aktif atau usang) atau CHANGE/TASK apa pun
 *     untuk field itu (perubahan titik ikut menjadi batas fakta detail/kedatangan sisi yang sama).
 *   - CHANGE/TASK yang dibuat (dan yang dieksekusi, execute.ts) menstempel `supersededAt` fakta aktif field itu
 *     yang pesannya lebih tua atau sama (`supersedeOlderFacts`), supaya tidak jadi MISMATCH palsu.
 *   - Yang sudah ditutup ORANG (closedById terisi: ditolak/dilepas/selesai/tak perlu/dibatalkan) tidak dibuat
 *     ulang untuk field + nilai yang sama; nilai lain tetap membuat kartu baru.
 *   - Usulan asli yang DIKOREKSI admin lalu dieksekusi (event CORRECTED pada aksi EXECUTED) juga tidak
 *     dibuat ulang: kartu baru dengan nilai itu akan membalik perubahan di produksi.
 *   - Dicakup per booking: hanya baris ber-bookingId sama dengan booking sekarang (atau null).
 *   - Kunci advisory per percakapan di awal transaksi mencegah baris OPEN/fakta ganda.
 *   - Label BUKAN urusan modul ini (Ruling R1). Notifikasi push (Task 8b) dikirim SESUDAH commit untuk
 *     tiap CHANGE/TASK/MISMATCH yang baru dibuat pada pemanggilan itu, fire-and-forget.
 */
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { broadcast } from '@/lib/realtime'
import type { BookingData } from '@/lib/booking/client'
import { changeAlreadyApplied, findMismatches, type ActiveFact } from './compare'
import { changeGroup, type ChangeGroup, type FieldKey } from './fields'
import { TSHIRT_UNCLEAR_TEXT, type Extraction } from './extract'
import { recordEvent, type BookingEventActor } from './history'
import { supersededFactFields, supersedeOlderFacts } from './fact-supersede'
import { notifyBookingAction, summarizeAction, type BookingPushEvent } from '@/lib/push/send'

type Tx = Prisma.TransactionClient
type Ctx = {
  tx: Tx
  conversationId: string
  bookingId: string | null
  booking: BookingData
  now: Date
  actor: BookingEventActor
  /** field+nilai yang pernah ditutup orang -- jangan dibuat ulang. */
  blocked: Set<string>
  times: Map<string, number>
  /** Dimuat sekali per pemanggilan saat pertama dibutuhkan (`watermarks`). */
  marks?: Watermarks
}
/** Waktu pesan sumber terbaru per field: `change` = CHANGE/TASK non-OPEN; `fact` = fakta apa pun + CHANGE/TASK apa pun. */
type Watermarks = { change: Map<string, number>; fact: Map<string, number> }
type Counters = {
  created: number
  resolved: number
  opened: number
  touched: boolean
  notify: BookingPushEvent[]
  /** true = push CHANGE ditahan di `deferred` (pemanggil menyerahkannya ke `autoApplyCreated`); false = langsung di `notify`. */
  deferChange: boolean
  deferred: BookingPushEvent[]
  /** Id kartu CHANGE/TASK yang dibuat pada pemanggilan ini (bukan MISMATCH) -- dasar tanda terima ke tamu. */
  cards: string[]
}

const CHANGE_TYPES = ['CHANGE', 'TASK']
// REVERTED (Task 11b, "Batalkan"): nilai yang dibatalkan admin tidak boleh diusulkan lagi (proposedValue = yang ditulis).
const PERSON_REASONS = ['REJECTED', 'DISMISSED_CHAT_WRONG', 'MARKED_DONE', 'NOT_NEEDED', 'REVERTED']

const key = (field: string, value: string | null) => `${field}\u0000${value ?? ''}`

function asBooking(raw: unknown): BookingData | null {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as BookingData) : null
}

function bookingIdOf(b: BookingData): string | null {
  const id = (b as Record<string, unknown>).booking_id
  return typeof id === 'string' || typeof id === 'number' ? String(id) : null
}

/** Kode booking untuk tampilan (mis. "JVTO-3899") = `bookingData.id`; bukan `booking_id` numerik. */
function bookingCodeOf(b: BookingData): string | null {
  const id = (b as Record<string, unknown>).id
  return typeof id === 'string' && id.trim() ? id.trim() : null
}

function proposedOf(raw: unknown): string | null {
  return typeof raw === 'string' ? raw : null
}

const inScope = (row: { bookingId: string | null }, bookingId: string | null) => row.bookingId === null || row.bookingId === bookingId

async function loadBooking(tx: Tx, conversationId: string): Promise<BookingData | null> {
  const conv = await tx.conversation.findUnique({ where: { id: conversationId }, select: { bookingData: true } })
  return asBooking(conv?.bookingData)
}

async function loadBlocked(tx: Tx, conversationId: string): Promise<Set<string>> {
  const rows = await tx.bookingAction.findMany({
    where: { conversationId, closedReason: { in: PERSON_REASONS } },
    select: { field: true, proposedValue: true, closedById: true },
  })
  const blocked = new Set(rows.filter((r) => r.closedById !== null).map((r) => key(r.field, proposedOf(r.proposedValue))))

  // Nilai yang dikoreksi admin saat "Setujui" (execute.ts): `proposedValue` sudah ditimpa koreksi, nilai
  // asli hanya ada di `oldValue` event CORRECTED. Untuk aksi yang EXECUTED, nilai asli itu diblokir --
  // kalau tidak, ekstraksi berikutnya mengusulkannya lagi dan "Setujui" akan membalik produksi.
  const corrections = (await tx.bookingActionEvent.findMany({
    where: { conversationId, event: 'CORRECTED' },
    select: { actionId: true, oldValue: true },
  })) ?? []
  const correctedIds = [...new Set(corrections.map((c) => c.actionId).filter((id): id is string => id !== null))]
  if (correctedIds.length > 0) {
    const executed = (await tx.bookingAction.findMany({
      where: { id: { in: correctedIds }, state: 'EXECUTED' },
      select: { id: true, field: true },
    })) ?? []
    const fieldOf = new Map(executed.map((r) => [r.id, r.field]))
    for (const c of corrections) {
      const field = c.actionId ? fieldOf.get(c.actionId) : undefined
      const original = proposedOf(c.oldValue)
      if (field && original !== null) blocked.add(key(field, original))
    }
  }
  return blocked
}

async function loadTimes(ctx: Ctx, ids: Array<string | null>): Promise<void> {
  const need = ids.filter((id): id is string => id !== null && !ctx.times.has(id))
  if (need.length === 0) return
  const rows = (await ctx.tx.message.findMany({ where: { id: { in: need } }, select: { id: true, createdAt: true } })) ?? []
  for (const r of rows) ctx.times.set(r.id, r.createdAt.getTime())
}

/** Apakah pesan `next` lebih baru daripada `prev`? Tidak diketahui = anggap lebih baru. */
function isNewer(ctx: Ctx, next: string | null, prev: string | null): boolean {
  if (next !== null && next === prev) return false
  const a = next === null ? undefined : ctx.times.get(next)
  const b = prev === null ? undefined : ctx.times.get(prev)
  if (a === undefined || b === undefined) return true
  return a > b
}

async function watermarks(ctx: Ctx): Promise<Watermarks> {
  if (ctx.marks) return ctx.marks
  const actions = ((await ctx.tx.bookingAction.findMany({
    where: { conversationId: ctx.conversationId, type: { in: CHANGE_TYPES } },
    select: { bookingId: true, field: true, state: true, sourceMessageId: true },
  })) ?? []).filter((r) => inScope(r, ctx.bookingId))
  const facts = ((await ctx.tx.bookingFact.findMany({
    where: { conversationId: ctx.conversationId },
    select: { bookingId: true, field: true, sourceMessageId: true },
  })) ?? []).filter((r) => inScope(r, ctx.bookingId))
  await loadTimes(ctx, [...actions, ...facts].map((r) => r.sourceMessageId))
  const marks: Watermarks = { change: new Map(), fact: new Map() }
  const bump = (m: Map<string, number>, field: string, id: string | null) => {
    const t = id === null ? undefined : ctx.times.get(id)
    if (t === undefined) return
    const cur = m.get(field)
    if (cur === undefined || t > cur) m.set(field, t)
  }
  for (const a of actions) {
    if (a.state !== 'OPEN') bump(marks.change, a.field, a.sourceMessageId)
    for (const f of supersededFactFields(a.field)) bump(marks.fact, f, a.sourceMessageId)
  }
  for (const f of facts) bump(marks.fact, f.field, f.sourceMessageId)
  ctx.marks = marks
  return marks
}

/** Pesan `messageId` lebih baru dari batas air field ini? Tanpa batas / waktu tak diketahui = ya (sama dengan `isNewer`). */
function aboveWatermark(ctx: Ctx, mark: Map<string, number>, field: string, messageId: string | null): boolean {
  const wm = mark.get(field)
  if (wm === undefined) return true
  const t = messageId === null ? undefined : ctx.times.get(messageId)
  if (t === undefined) return true
  return t > wm
}

/**
 * Satu butir per field: yang pesan sumbernya TERBARU. Waktu sama/tak diketahui = butir yang datang belakangan
 * menang (perilaku lama).
 */
async function newestPerField<T extends { field: FieldKey; messageId: string }>(ctx: Ctx, items: T[]): Promise<T[]> {
  await loadTimes(ctx, items.map((i) => i.messageId))
  const best = new Map<string, T>()
  for (const item of items) {
    const cur = best.get(item.field)
    const a = cur ? ctx.times.get(cur.messageId) : undefined
    const b = ctx.times.get(item.messageId)
    if (!cur || a === undefined || b === undefined || b >= a) best.set(item.field, item)
  }
  return [...best.values()]
}

async function closeAction(
  ctx: Ctx,
  action: { id: string; field: string; proposedValue: unknown },
  state: 'SUPERSEDED' | 'RESOLVED',
  closedReason: string,
  sourceMessageId?: string | null
): Promise<boolean> {
  // Bersyarat pada OPEN: baris yang baru saja diklaim "Setujui" (EXECUTING, execute.ts) atau ditutup
  // orang di antara bacaan dan tulisan ini tidak boleh ditimpa. count 0 = tidak ada transisi, tidak ada event.
  const res = await ctx.tx.bookingAction.updateMany({
    where: { id: action.id, state: 'OPEN' },
    data: { state, closedReason, closedAt: ctx.now },
  })
  if (res.count === 0) return false
  await recordEvent(ctx.tx, {
    conversationId: ctx.conversationId,
    bookingId: ctx.bookingId,
    actionId: action.id,
    event: state,
    actor: ctx.actor === 'BOT' && state === 'RESOLVED' ? 'SYSTEM' : ctx.actor,
    oldValue: { field: action.field, value: proposedOf(action.proposedValue) },
    sourceMessageId: sourceMessageId ?? null,
    reason: closedReason,
  })
  return true
}

async function createAction(
  ctx: Ctx,
  counters: Counters,
  data: { type: 'CHANGE' | 'TASK' | 'MISMATCH'; field: FieldKey; tier: ChangeGroup; value: string; messageId: string | null }
): Promise<void> {
  const row = await ctx.tx.bookingAction.create({
    data: {
      conversationId: ctx.conversationId,
      bookingId: ctx.bookingId,
      type: data.type,
      field: data.field,
      tier: data.tier,
      proposedValue: data.value,
      state: 'OPEN',
      sourceMessageId: data.messageId,
    },
    select: { id: true },
  })
  counters.created++
  if (data.type !== 'MISMATCH') counters.cards.push(row.id)
  // Permintaan perubahan melewati fakta lama field itu (Important 5).
  if (data.type !== 'MISMATCH') {
    await supersedeOlderFacts(ctx.tx, {
      conversationId: ctx.conversationId, bookingId: ctx.bookingId, field: data.field, sourceMessageId: data.messageId, now: ctx.now,
    })
  }
  const event: BookingPushEvent = {
    kind: data.type,
    conversationId: ctx.conversationId,
    bookingCode: bookingCodeOf(ctx.booking),
    summary: summarizeAction(data.field, data.value),
    actionId: row.id,
    messageId: data.messageId,
  }
  // Keputusan owner 2026-10-20: kartu CHANGE yang mungkin diterapkan otomatis tidak dikabari saat dibuat;
  // `autoApplyCreated` mengirim AUTO_APPLIED sesudah berhasil, atau push CHANGE ini bila kartu tetap OPEN.
  if (data.type === 'CHANGE' && counters.deferChange) counters.deferred.push(event)
  else counters.notify.push(event)
  await recordEvent(ctx.tx, {
    conversationId: ctx.conversationId,
    bookingId: ctx.bookingId,
    actionId: row.id,
    event: 'CREATED',
    actor: ctx.actor,
    newValue: { type: data.type, field: data.field, value: data.value },
    sourceMessageId: data.messageId,
  })
}

type OpenRow = { id: string; bookingId: string | null; type: string; field: string; proposedValue: unknown; sourceMessageId: string | null }

async function loadOpen(ctx: Ctx, types: string[]): Promise<OpenRow[]> {
  const rows = (await ctx.tx.bookingAction.findMany({
    where: { conversationId: ctx.conversationId, state: 'OPEN', type: { in: types } },
    select: { id: true, bookingId: true, type: true, field: true, proposedValue: true, sourceMessageId: true },
  })) as OpenRow[]
  return rows.filter((r) => inScope(r, ctx.bookingId))
}

/** Buat usulan baru; sama = dibiarkan, lebih baru = menggantikan, lebih lama = dilewati. */
async function proposeChange(
  ctx: Ctx,
  counters: Counters,
  open: OpenRow[],
  p: { field: FieldKey; value: string; messageId: string | null },
  forceTask = false
): Promise<boolean> {
  if (ctx.blocked.has(key(p.field, p.value))) return false
  // Batas air: pesan yang sudah dilewati CHANGE/TASK yang ditutup tidak mengusulkan apa pun lagi.
  const marks = await watermarks(ctx)
  await loadTimes(ctx, [p.messageId])
  if (!aboveWatermark(ctx, marks.change, p.field, p.messageId)) return false
  const group = forceTask ? 'HEAVY' : changeGroup(p.field, p.value, ctx.booking)
  const sameField = open.filter((r) => CHANGE_TYPES.includes(r.type) && r.field === p.field)
  if (sameField.some((r) => proposedOf(r.proposedValue) === p.value)) return false
  await loadTimes(ctx, [p.messageId, ...sameField.map((r) => r.sourceMessageId)])
  if (!sameField.every((r) => isNewer(ctx, p.messageId, r.sourceMessageId))) return false
  for (const old of sameField) {
    await closeAction(ctx, old, 'SUPERSEDED', 'REPLACED', p.messageId)
    open.splice(open.indexOf(old), 1)
  }
  await createAction(ctx, counters, { type: group === 'HEAVY' ? 'TASK' : 'CHANGE', field: p.field, tier: group, value: p.value, messageId: p.messageId })
  return true
}

async function evaluate(ctx: Ctx, counters: Counters): Promise<void> {
  const { tx, conversationId, booking } = ctx
  const open = await loadOpen(ctx, [...CHANGE_TYPES, 'MISMATCH'])
  const factRows = (await tx.bookingFact.findMany({ where: { conversationId } })).filter((f) => inScope(f, ctx.bookingId))

  // 1. CHANGE/TASK yang sudah sesuai di backoffice.
  for (const a of [...open]) {
    if (!CHANGE_TYPES.includes(a.type)) continue
    const value = proposedOf(a.proposedValue)
    if (value !== null && changeAlreadyApplied({ field: a.field as FieldKey, value }, booking)) {
      const closed = await closeAction(ctx, a, 'RESOLVED', 'MATCHED_IN_BACKOFFICE')
      open.splice(open.indexOf(a), 1)
      if (!closed) continue
      counters.resolved++
      counters.touched = true
    }
  }

  // 2. Fakta aktif vs booking.
  const active: ActiveFact[] = factRows
    .filter((f) => f.supersededAt === null)
    .map((f) => ({ id: f.id, field: f.field as FieldKey, value: f.value }))
  const mismatches = findMismatches(active, booking)
  const keep = new Set<string>()
  for (const m of mismatches) if (m.bookingValue !== null) keep.add(key(m.field, m.chatValue))

  for (const a of [...open]) {
    if (a.type !== 'MISMATCH') continue
    const value = proposedOf(a.proposedValue)
    if (keep.has(key(a.field, value))) continue
    // Fakta yang sama (field + nilai) masih aktif dan kini cocok = backoffice menyusul;
    // selain itu tamu mengoreksi dirinya sendiri.
    const stillStated = active.some((f) => f.field === a.field && f.value === value)
    const closed = await closeAction(ctx, a, 'RESOLVED', stillStated ? 'MATCHED_IN_BACKOFFICE' : 'CHAT_CORRECTED')
    open.splice(open.indexOf(a), 1)
    if (!closed) continue
    counters.resolved++
    counters.touched = true
  }

  for (const m of mismatches) {
    const fact = factRows.find((f) => f.id === m.factId)
    const messageId = fact?.sourceMessageId ?? null
    if (m.bookingValue !== null) {
      if (open.some((a) => a.type === 'MISMATCH' && a.field === m.field && proposedOf(a.proposedValue) === m.chatValue)) continue
      if (ctx.blocked.has(key(m.field, m.chatValue))) continue
      await createAction(ctx, counters, { type: 'MISMATCH', field: m.field, tier: changeGroup(m.field, m.chatValue, booking), value: m.chatValue, messageId })
      counters.opened++
      counters.touched = true
      continue
    }
    // Booking kosong, tamu menyebut nilai: "isi data" untuk AI/BALI, HEAVY diabaikan (R8).
    if (changeGroup(m.field, m.chatValue, booking) === 'HEAVY') continue
    if (await proposeChange(ctx, counters, open, { field: m.field, value: m.chatValue, messageId })) {
      counters.opened++
      counters.touched = true
    }
  }
}

async function run(
  conversationId: string,
  now: Date,
  actor: BookingEventActor,
  body: (ctx: Ctx, counters: Counters) => Promise<void>,
  deferChange = false
): Promise<Counters> {
  const counters: Counters = { created: 0, resolved: 0, opened: 0, touched: false, notify: [], deferChange, deferred: [], cards: [] }
  await prisma.$transaction(async (tx) => {
    // Kunci per percakapan (dilepas saat commit): dua proses tak boleh menyisipkan baris OPEN/fakta ganda.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${conversationId}))`
    const booking = await loadBooking(tx, conversationId)
    if (!booking) return
    const blocked = await loadBlocked(tx, conversationId)
    await body({ tx, conversationId, bookingId: bookingIdOf(booking), booking, now, actor, blocked, times: new Map() }, counters)
  })
  if (counters.touched) broadcast({ type: 'booking-actions.changed', conversationId })
  // Fire-and-forget: tidak di-await dan tidak boleh melempar ke jalur webhook.
  for (const e of counters.notify) {
    try {
      void Promise.resolve(notifyBookingAction(e)).catch(() => undefined)
    } catch {
      // notifyBookingAction sendiri tidak melempar; ini sabuk pengaman.
    }
  }
  return counters
}

/**
 * `changeEvents` = push CHANGE kartu CHANGE yang dibuat pada pemanggilan ini, TIDAK dikirim di sini. Pemanggil WAJIB
 * menyerahkannya ke `autoApplyCreated` (schedule.ts), yang menerapkan otomatis lalu mengirim AUTO_APPLIED, atau
 * mengirim push CHANGE itu bila kartu tetap OPEN. `changeIds` = id-id yang sama.
 */
export async function applyExtraction(
  conversationId: string,
  ex: Extraction,
  now: Date = new Date()
): Promise<{ created: number; changeIds: string[]; changeEvents: BookingPushEvent[]; cardIds: string[] }> {
  const c = await run(conversationId, now, 'BOT', async (ctx, counters) => {
    const { tx } = ctx
    const existing = (await tx.bookingFact.findMany({ where: { conversationId, supersededAt: null } })).filter((f) => inScope(f, ctx.bookingId))
    const marks = await watermarks(ctx)
    for (const f of await newestPerField(ctx, ex.facts)) {
      const same = existing.filter((e) => e.field === f.field && e.supersededAt === null)
      if (same.some((e) => e.value === f.value)) continue
      // Pesan lama yang terbaca ulang tidak menimpa fakta/permintaan yang lebih baru.
      if (!aboveWatermark(ctx, marks.fact, f.field, f.messageId)) continue
      for (const old of same) {
        await tx.bookingFact.update({ where: { id: old.id }, data: { supersededAt: now } })
        old.supersededAt = now
      }
      const row = await tx.bookingFact.create({
        data: { conversationId, bookingId: ctx.bookingId, field: f.field, value: f.value, sourceMessageId: f.messageId, statedAt: now },
      })
      existing.push(row)
      counters.touched = true
    }
    const open = await loadOpen(ctx, CHANGE_TYPES)
    for (const ch of await newestPerField(ctx, ex.changes)) {
      if (changeAlreadyApplied({ field: ch.field, value: ch.value }, ctx.booking)) continue
      if (await proposeChange(ctx, counters, open, { field: ch.field, value: ch.value, messageId: ch.messageId })) counters.touched = true
    }
    // Ukuran kaos yang tak terbaca (mis. "2xl" ambigu) tidak dibuang diam-diam: TASK untuk orang (tanpa terapkan-otomatis).
    for (const u of ex.unclear ?? []) {
      if (await proposeChange(ctx, counters, open, { field: u.field, value: TSHIRT_UNCLEAR_TEXT, messageId: u.messageId }, true)) counters.touched = true
    }
    await evaluate(ctx, counters)
  }, true)
  return { created: c.created, changeIds: c.deferred.map((e) => e.actionId), changeEvents: c.deferred, cardIds: c.cards }
}

export async function reevaluateBookingActions(conversationId: string, now: Date = new Date()): Promise<{ resolved: number; opened: number }> {
  const c = await run(conversationId, now, 'SYSTEM', (ctx, counters) => evaluate(ctx, counters))
  return { resolved: c.resolved, opened: c.opened }
}
