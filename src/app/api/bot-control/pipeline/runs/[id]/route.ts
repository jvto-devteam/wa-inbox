import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth/get-session'
import { parsePipelineSteps } from '@/lib/bot-control/pipeline-runs'

/**
 * GET /api/bot-control/pipeline/runs/[id] — jejak langkah SATU run, untuk diputar ulang di
 * kanvas.
 *
 * Di sinilah `steps` dikirim lengkap; daftar di route induk hanya mendapat ringkasannya.
 * Pembagian itu disengaja: yang mahal (satu array per run) hanya dibayar untuk run yang
 * benar-benar dibuka operator, satu per satu.
 *
 * `trace` tetap tidak ikut, walau ini route detail. Kanvas menggambar BATAS STEP, bukan isi
 * penalaran; yang mau membaca penalaran membuka run yang sama di Decision Logs — id-nya sama
 * persis, karena tracer membuat `runId` di awal dan menyerahkannya ke `recordBotDecisionRun`
 * sebagai `id`. Satu payload yang tidak dibaca siapa pun adalah satu payload yang tidak perlu
 * dikirim.
 *
 * `steps` dibaca lewat `parsePipelineSteps`: kolomnya Json bebas, dan entri yang tidak dikenal
 * dibuang di sini supaya kanvas tidak pernah menerima stepId yang tidak punya kotak.
 */

const DETAIL_SELECT = {
  id: true,
  conversationId: true,
  messageId: true,
  mode: true,
  status: true,
  inboundText: true,
  latencyMs: true,
  error: true,
  startedAt: true,
  finishedAt: true,
  steps: true,
} as const

const INBOUND_PREVIEW_LENGTH = 500

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 })

  const { id } = await params

  try {
    const run = await prisma.botDecisionRun.findUnique({ where: { id }, select: DETAIL_SELECT })
    if (!run) return NextResponse.json({ error: 'Run tidak ditemukan' }, { status: 404 })

    const conversation = await prisma.conversation.findUnique({
      where: { id: run.conversationId },
      select: { id: true, contact: { select: { name: true, phone: true } } },
    })

    const steps = parsePipelineSteps(run.steps)

    return NextResponse.json({
      id: run.id,
      conversationId: run.conversationId,
      messageId: run.messageId,
      contactName: conversation?.contact?.name ?? null,
      contactPhone: conversation?.contact?.phone ?? null,
      mode: run.mode,
      status: run.status,
      inboundPreview: run.inboundText.slice(0, INBOUND_PREVIEW_LENGTH),
      latencyMs: run.latencyMs,
      error: run.error,
      startedAt: run.startedAt.toISOString(),
      finishedAt: run.finishedAt?.toISOString() ?? null,
      // `null` di sini berarti TIDAK TEREKAM (run sebelum instrumentasi ada, atau jalur tanpa
      // tracer seperti simulator Test Lab), bukan "gagal" dan bukan "kosong". UI wajib
      // membedakannya — lihat pipeline-runs.ts.
      steps: steps !== null && steps.length > 0 ? steps : null,
    })
  } catch (error) {
    console.error('GET /api/bot-control/pipeline/runs/[id] gagal', error)
    return NextResponse.json({ error: 'Gagal memuat detail run pipeline' }, { status: 500 })
  }
}
