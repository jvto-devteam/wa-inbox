import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth/get-session'
import { parseJsonBody } from '@/lib/parse-json'
import { canUseDryRun } from '@/lib/booking-actions/rollout'

const bodySchema = z.object({ enabled: z.boolean() })

/**
 * Menyalakan/mematikan "Mode uji tanpa WA" (owner 2026-10-21): admin bisa chat sebagai tamu maupun sebagai JVTO di
 * percakapan nomor uji, dan setiap kiriman hanya dicatat (src/lib/send.ts), tidak pernah sampai ke WhatsApp. Ditolak
 * untuk nomor di luar whitelist supaya tidak pernah bisa memalsukan pesan pelanggan sungguhan.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession(req)
    if (!session) return NextResponse.json({ error: 'Belum masuk' }, { status: 401 })
    const { id } = await params
    const parsed = await parseJsonBody(req, bodySchema, 'Isi enabled (true/false)')
    if (!parsed.success) return NextResponse.json({ error: parsed.error }, { status: 400 })

    const conv = await prisma.conversation.findUnique({ where: { id }, select: { isTest: true, contact: { select: { phone: true } } } })
    if (!conv) return NextResponse.json({ error: 'Percakapan tidak ditemukan' }, { status: 404 })
    if (!canUseDryRun(conv)) return NextResponse.json({ error: 'Mode uji hanya untuk nomor uji (whitelist)' }, { status: 403 })

    const updated = await prisma.conversation.update({ where: { id }, data: { dryRun: parsed.data.enabled }, select: { dryRun: true } })
    return NextResponse.json({ dryRun: updated.dryRun })
  } catch (error) {
    console.error('dry-run gagal', { error: error instanceof Error ? error.name : 'unknown' })
    return NextResponse.json({ error: 'Gagal mengubah mode uji' }, { status: 500 })
  }
}
