/**
 * Eskalasi telepon (owner 2026-11-27): notif HP "Belum dibalas" / "Komplain-masalah" sudah terkirim, dan sesudah
 * `WAIT_MS` (15 menit) belum ada tindakan -> admin ditelepon lewat telepon-service, suaranya rekaman
 * "Ada pesan tamu belum dibalas / komplain atau masalah dari tamu, cek di wa inbox". Mengikuti pola reminder crew
 * di chat-server (rantai dicatat di tabel, dievaluasi ulang tiap sapuan), tetapi satu penerima: satu telepon per notif.
 *
 * - `armCallEscalation`: dipanggil tepat saat notifnya terkirim (`push/queue.ts` untuk Balas, `push/problems.ts` untuk
 *   masalah). Hanya notif PERTAMA per kartu Balas; pengingat ulang tiap jam tidak menelepon lagi. Janji Admin dan Follow
 *   Up tidak menelepon.
 * - `runCallEscalations` (tick 5 menit): ARMED yang sudah jatuh tempo -> cek tindakan -> telepon.
 *   Tindakan Balas = kartu tidak OPEN lagi (dibalas / Lepas / Ingatkan) atau anchor-nya berganti.
 *   Tindakan masalah = ada pesan keluar AGEN di chat itu sesudah notif (bot dan kabar sistem tidak dihitung).
 * - Klaim ARMED -> CALLING bersyarat sebelum menelepon: tick tumpang tindih / restart tidak menelepon dua kali, dan
 *   `idempotencyKey` ke telepon-service menjadi lapis kedua. Batas per jam telepon-service (429) = tetap ARMED, dicoba
 *   lagi tick berikutnya selama belum basi. Telepon sudah dilakukan tidak diulang walau tidak diangkat.
 * - Tidak pernah melempar. Isi catatan tanpa nomor, nama, atau teks pelanggan.
 */
import { prisma } from '@/lib/db'
import { getCallOutcome, placeCall } from './client'
import { AUDIO_BY_KIND, STALE_AFTER_MS, WAIT_MS, escalationConfig } from './config'

const MAX_PER_TICK = 20
const POLL_WINDOW_MS = 30 * 60 * 1000
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000

export type ArmInput =
  | { kind: 'REPLY'; conversationId: string; itemId: string; anchorAt: Date }
  | { kind: 'PROBLEM'; conversationId: string; label: string }

export async function armCallEscalation(input: ArmInput, now: Date = new Date()): Promise<void> {
  try {
    if (!escalationConfig()) return
    const triggerKey =
      input.kind === 'REPLY'
        ? `reply:${input.itemId}:${input.anchorAt.getTime()}`
        : `problem:${input.conversationId}:${input.label}:${now.getTime()}`
    await prisma.callEscalation.create({
      data: {
        kind: input.kind,
        conversationId: input.conversationId,
        triggerKey,
        armedAt: now,
        ...(input.kind === 'REPLY' ? { itemId: input.itemId, anchorAt: input.anchorAt } : { label: input.label }),
      },
    })
  } catch (error) {
    // P2002 = pemicu yang sama sudah tercatat (idempoten); selain itu hanya dicatat.
    if (!(typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002')) console.error('armCallEscalation gagal')
  }
}

type Row = { id: string; kind: string; conversationId: string; itemId: string | null; anchorAt: Date | null; armedAt: Date }

async function isHandled(row: Row): Promise<boolean> {
  if (row.kind === 'REPLY') {
    if (!row.itemId || !row.anchorAt) return true
    const item = await prisma.summaryItem.findUnique({ where: { id: row.itemId }, select: { state: true, anchorAt: true } })
    return !item || item.state !== 'OPEN' || item.anchorAt.getTime() !== row.anchorAt.getTime()
  }
  const reply = await prisma.message.findFirst({
    where: { conversationId: row.conversationId, direction: 'OUTBOUND', sentBy: 'AGENT', createdAt: { gt: row.armedAt } },
    select: { id: true },
  })
  return reply !== null
}

export async function runCallEscalations(now: Date = new Date()): Promise<{ called: number; dry: number; resolved: number; expired: number; failed: number }> {
  const result = { called: 0, dry: 0, resolved: 0, expired: 0, failed: 0 }
  const cfg = escalationConfig()
  if (!cfg) return result
  try {
    const due = await prisma.callEscalation.findMany({
      where: { status: 'ARMED', armedAt: { lte: new Date(now.getTime() - WAIT_MS) } },
      orderBy: { armedAt: 'asc' },
      take: MAX_PER_TICK,
      select: { id: true, kind: true, conversationId: true, itemId: true, anchorAt: true, armedAt: true },
    })
    for (const row of due) {
      const dueAt = row.armedAt.getTime() + WAIT_MS
      if (now.getTime() - dueAt > STALE_AFTER_MS) {
        await prisma.callEscalation.update({ where: { id: row.id }, data: { status: 'EXPIRED', detail: 'basi' } })
        result.expired++
        continue
      }
      if (await isHandled(row)) {
        await prisma.callEscalation.update({ where: { id: row.id }, data: { status: 'RESOLVED' } })
        result.resolved++
        continue
      }
      const claim = await prisma.callEscalation.updateMany({ where: { id: row.id, status: 'ARMED' }, data: { status: 'CALLING' } })
      if (claim.count === 0) continue
      if (cfg.mode === 'dry') {
        await prisma.callEscalation.update({ where: { id: row.id }, data: { status: 'DRY_RUN' } })
        result.dry++
        continue
      }
      const placed = await placeCall(cfg, { audio: AUDIO_BY_KIND[row.kind === 'REPLY' ? 'REPLY' : 'PROBLEM'], idempotencyKey: `wai-${row.id}` })
      if (placed.ok) {
        await prisma.callEscalation.update({ where: { id: row.id }, data: { status: 'CALLED', jobId: placed.jobId } })
        result.called++
      } else if (placed.rateLimited) {
        await prisma.callEscalation.update({ where: { id: row.id }, data: { status: 'ARMED', detail: 'batas per jam telepon-service' } })
      } else {
        await prisma.callEscalation.update({ where: { id: row.id }, data: { status: 'FAILED', detail: `telepon-service ${placed.status}` } })
        result.failed++
      }
    }

    // Hasil telepon (diangkat / tidak) dicatat untuk dilihat; tidak mengubah keputusan apa pun.
    if (cfg.mode === 'live') {
      const pending = await prisma.callEscalation.findMany({
        where: { status: 'CALLED', outcome: null, updatedAt: { gte: new Date(now.getTime() - POLL_WINDOW_MS) }, jobId: { not: null } },
        take: 10,
        select: { id: true, jobId: true },
      })
      for (const p of pending) {
        const out = p.jobId ? await getCallOutcome(cfg, p.jobId) : null
        if (out?.finished) await prisma.callEscalation.update({ where: { id: p.id }, data: { outcome: out.outcome ?? 'unknown' } })
      }
    }

    await prisma.callEscalation.deleteMany({ where: { armedAt: { lt: new Date(now.getTime() - RETENTION_MS) } } })
  } catch {
    console.error('runCallEscalations gagal')
  }
  return result
}
