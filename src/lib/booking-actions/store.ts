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
 *     HEAVY -> diabaikan. CHANGE isi-data hanya menggantikan usulan OPEN yang lahir dari fakta
 *     lama yang sudah diganti (jangan menimpa permintaan eksplisit tamu).
 *   - Notifikasi/label BUKAN urusan modul ini (Ruling R1).
 */
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { broadcast } from '@/lib/realtime'
import type { BookingData } from '@/lib/booking/client'
import { changeAlreadyApplied, findMismatches, type ActiveFact } from './compare'
import { changeGroup, type ChangeGroup, type FieldKey } from './fields'
import type { Extraction } from './extract'
import { recordEvent, type BookingEventActor } from './history'

type Tx = Prisma.TransactionClient
type Ctx = { tx: Tx; conversationId: string; bookingId: string | null; booking: BookingData; now: Date; actor: BookingEventActor }
type Counters = { created: number; resolved: number; opened: number; touched: boolean }

const CHANGE_TYPES = ['CHANGE', 'TASK']

function asBooking(raw: unknown): BookingData | null {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as BookingData) : null
}

function bookingIdOf(b: BookingData): string | null {
  const id = (b as Record<string, unknown>).booking_id
  return typeof id === 'string' || typeof id === 'number' ? String(id) : null
}

function proposedOf(raw: unknown): string | null {
  return typeof raw === 'string' ? raw : null
}

async function loadBooking(tx: Tx, conversationId: string): Promise<BookingData | null> {
  const conv = await tx.conversation.findUnique({ where: { id: conversationId }, select: { bookingData: true } })
  return asBooking(conv?.bookingData)
}

async function closeAction(
  ctx: Ctx,
  action: { id: string; field: string; proposedValue: unknown },
  state: 'SUPERSEDED' | 'RESOLVED',
  closedReason: string,
  sourceMessageId?: string | null
): Promise<void> {
  await ctx.tx.bookingAction.update({ where: { id: action.id }, data: { state, closedReason, closedAt: ctx.now } })
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
}

async function createAction(
  ctx: Ctx,
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

type OpenRow = { id: string; type: string; field: string; proposedValue: unknown; sourceMessageId: string | null }

/** Buat usulan baru; yang OPEN dengan nilai sama dibiarkan, yang berbeda diganti. */
async function proposeChange(
  ctx: Ctx,
  open: OpenRow[],
  p: { field: FieldKey; value: string; messageId: string | null; replaceable?: (row: OpenRow) => boolean }
): Promise<boolean> {
  const group = changeGroup(p.field, p.value, ctx.booking)
  const sameField = open.filter((r) => CHANGE_TYPES.includes(r.type) && r.field === p.field)
  if (sameField.some((r) => proposedOf(r.proposedValue) === p.value)) return false
  const replaceable = p.replaceable ?? (() => true)
  if (!sameField.every(replaceable)) return false
  for (const old of sameField) {
    await closeAction(ctx, old, 'SUPERSEDED', 'REPLACED', p.messageId)
    open.splice(open.indexOf(old), 1)
  }
  await createAction(ctx, { type: group === 'HEAVY' ? 'TASK' : 'CHANGE', field: p.field, tier: group, value: p.value, messageId: p.messageId })
  return true
}

async function evaluate(ctx: Ctx, counters: Counters): Promise<void> {
  const { tx, conversationId, booking } = ctx
  const open = (await tx.bookingAction.findMany({
    where: { conversationId, state: 'OPEN', type: { in: [...CHANGE_TYPES, 'MISMATCH'] } },
    select: { id: true, type: true, field: true, proposedValue: true, sourceMessageId: true },
  })) as OpenRow[]
  const factRows = await tx.bookingFact.findMany({ where: { conversationId } })

  // 1. CHANGE/TASK yang sudah sesuai di backoffice.
  for (const a of [...open]) {
    if (!CHANGE_TYPES.includes(a.type)) continue
    const value = proposedOf(a.proposedValue)
    if (value !== null && changeAlreadyApplied({ field: a.field as FieldKey, value }, booking)) {
      await closeAction(ctx, a, 'RESOLVED', 'MATCHED_IN_BACKOFFICE')
      open.splice(open.indexOf(a), 1)
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
  for (const m of mismatches) if (m.bookingValue !== null) keep.add(`${m.field}\u0000${m.chatValue}`)

  for (const a of [...open]) {
    if (a.type !== 'MISMATCH') continue
    if (keep.has(`${a.field}\u0000${proposedOf(a.proposedValue)}`)) continue
    const stillStated = active.some((f) => f.field === a.field)
    await closeAction(ctx, a, 'RESOLVED', stillStated ? 'MATCHED_IN_BACKOFFICE' : 'CHAT_CORRECTED')
    open.splice(open.indexOf(a), 1)
    counters.resolved++
    counters.touched = true
  }

  const oldFactValues = factRows.filter((f) => f.supersededAt !== null)
  for (const m of mismatches) {
    const fact = factRows.find((f) => f.id === m.factId)
    const messageId = fact?.sourceMessageId ?? null
    if (m.bookingValue !== null) {
      if (open.some((a) => a.type === 'MISMATCH' && a.field === m.field && proposedOf(a.proposedValue) === m.chatValue)) continue
      await createAction(ctx, { type: 'MISMATCH', field: m.field, tier: changeGroup(m.field, m.chatValue, booking), value: m.chatValue, messageId })
      counters.opened++
      counters.touched = true
      continue
    }
    // Booking kosong, tamu menyebut nilai: "isi data" untuk AI/BALI, HEAVY diabaikan (R8).
    if (changeGroup(m.field, m.chatValue, booking) === 'HEAVY') continue
    const created = await proposeChange(ctx, open, {
      field: m.field,
      value: m.chatValue,
      messageId,
      replaceable: (row) =>
        oldFactValues.some((f) => f.field === row.field && f.value === proposedOf(row.proposedValue) && f.sourceMessageId === row.sourceMessageId),
    })
    if (created) {
      counters.opened++
      counters.touched = true
    }
  }
}

async function run(
  conversationId: string,
  now: Date,
  actor: BookingEventActor,
  body: (ctx: Ctx, counters: Counters) => Promise<void>
): Promise<Counters> {
  const counters: Counters = { created: 0, resolved: 0, opened: 0, touched: false }
  await prisma.$transaction(async (tx) => {
    const booking = await loadBooking(tx, conversationId)
    if (!booking) return
    await body({ tx, conversationId, bookingId: bookingIdOf(booking), booking, now, actor }, counters)
  })
  if (counters.touched) broadcast({ type: 'booking-actions.changed', conversationId })
  return counters
}

export async function applyExtraction(conversationId: string, ex: Extraction, now: Date = new Date()): Promise<{ created: number }> {
  const c = await run(conversationId, now, 'BOT', async (ctx, counters) => {
    const { tx } = ctx
    const existing = await tx.bookingFact.findMany({ where: { conversationId, supersededAt: null } })
    for (const f of ex.facts) {
      const same = existing.filter((e) => e.field === f.field && e.supersededAt === null)
      if (same.some((e) => e.value === f.value)) continue
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
    const open = (await tx.bookingAction.findMany({
      where: { conversationId, state: 'OPEN', type: { in: CHANGE_TYPES } },
      select: { id: true, type: true, field: true, proposedValue: true, sourceMessageId: true },
    })) as OpenRow[]
    for (const ch of ex.changes) {
      if (changeAlreadyApplied({ field: ch.field, value: ch.value }, ctx.booking)) continue
      if (await proposeChange(ctx, open, { field: ch.field, value: ch.value, messageId: ch.messageId })) {
        counters.created++
        counters.touched = true
      }
    }
    await evaluate(ctx, counters)
  })
  return { created: c.created }
}

export async function reevaluateBookingActions(conversationId: string, now: Date = new Date()): Promise<{ resolved: number; opened: number }> {
  const c = await run(conversationId, now, 'SYSTEM', (ctx, counters) => evaluate(ctx, counters))
  return { resolved: c.resolved, opened: c.opened }
}
