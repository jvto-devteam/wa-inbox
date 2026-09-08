import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth/get-session'
import { summarisePipelineSteps } from '@/lib/bot-control/pipeline-runs'

/**
 * GET /api/bot-control/pipeline/runs — run terakhir untuk daftar "riwayat" di kanvas Alur Live.
 *
 * Read-only untuk setiap user yang login, sama seperti route Decision Logs di sebelahnya: ini
 * adalah pandangan atas jalur bot, bukan tombol yang mengubah apa pun.
 *
 * TIDAK ADA TABEL BARU untuk fitur ini. Riwayat run adalah `BotDecisionRun` yang sudah ada;
 * kanvas hanya membacanya dari sudut yang berbeda.
 *
 * --- Kenapa `select` eksplisit, dan kenapa `trace` tidak ada di dalamnya ---
 *
 * `trace` adalah kolom terbesar di tabel ini (seluruh penalaran satu giliran bot) dan halaman
 * ini tidak menggambar satu pun byte darinya. Menariknya berarti memindahkan puluhan trace
 * lewat kabel untuk dibuang begitu sampai — persis temuan audit Q4 yang baru diperbaiki di
 * route decisions, dan mengulanginya di route baru berarti memperbaiki satu tempat sambil
 * membuka lubang yang sama di sebelahnya. Siapa pun yang butuh trace membukanya di Decision
 * Logs, yang memang route-nya.
 *
 * `steps` IKUT ditarik, dan itu keputusan yang berbeda, bukan inkonsistensi: ukurannya dibatasi
 * keras di sisi penulis (MAX_STEPS_PER_RUN = 64 entri, detail dipotong di 512 karakter, lihat
 * pipeline/tracer.ts), sementara `trace` tidak dibatasi sama sekali. Yang dikirim keluar pun
 * hanya RINGKASANNYA — "berhenti di gerbang-bot", tiga angka dan dua string — bukan arraynya.
 * Jejak lengkapnya menunggu sampai satu run benar-benar dibuka, di route `[id]`.
 */

/** Persis kolom yang dipakai baris daftar. `trace` sengaja tidak ada — lihat di atas. */
const LIST_SELECT = {
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

const INBOUND_PREVIEW_LENGTH = 120
const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50

export async function GET(req: Request) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 })

  const url = new URL(req.url)
  const requested = Number(url.searchParams.get('limit'))
  // Dijepit, bukan di-400-kan: `?limit=abc` dari tautan yang salah ketik harus memberi halaman
  // yang wajar, bukan banner error. Batas atasnya keras supaya satu tab tidak bisa meminta
  // seluruh tabel.
  const limit = Number.isFinite(requested) && requested > 0 ? Math.min(Math.floor(requested), MAX_LIMIT) : DEFAULT_LIMIT

  const where: Prisma.BotDecisionRunWhereInput = {}
  const conversationId = url.searchParams.get('conversationId')?.trim()
  if (conversationId) where.conversationId = conversationId

  try {
    const runs = await prisma.botDecisionRun.findMany({
      where,
      orderBy: { startedAt: 'desc' },
      take: limit,
      select: LIST_SELECT,
    })

    // Nama kontak diambil dalam SATU query untuk seluruh halaman, bukan satu query per baris.
    // BotDecisionRun memang tidak punya foreign key ke Conversation (baris audit harus bisa
    // hidup lebih lama daripada yang dijelaskannya), jadi ia tidak bisa di-`include`.
    const conversationIds = [...new Set(runs.map((run) => run.conversationId))]
    const conversations =
      conversationIds.length === 0
        ? []
        : await prisma.conversation.findMany({
            where: { id: { in: conversationIds } },
            select: { id: true, contact: { select: { name: true, phone: true } } },
          })
    const contactByConversation = new Map(conversations.map((c) => [c.id, c.contact]))

    return NextResponse.json({
      items: runs.map((run) => {
        const contact = contactByConversation.get(run.conversationId)
        const steps = summarisePipelineSteps(run.steps)
        return {
          id: run.id,
          conversationId: run.conversationId,
          messageId: run.messageId,
          // Null berarti percakapannya sudah dihapus; barisnya tetap hidup. Mengatakannya
          // lebih berguna daripada sel kosong yang terlihat seperti bug.
          contactName: contact?.name ?? null,
          contactPhone: contact?.phone ?? null,
          mode: run.mode,
          status: run.status,
          inboundPreview: run.inboundText.slice(0, INBOUND_PREVIEW_LENGTH),
          latencyMs: run.latencyMs,
          error: run.error,
          startedAt: run.startedAt.toISOString(),
          finishedAt: run.finishedAt?.toISOString() ?? null,
          // Ringkasan, bukan jejaknya. `stepsRecorded: false` berarti run ini berjalan sebelum
          // instrumentasi ada — bukan berarti ia gagal.
          stepsRecorded: steps.recorded,
          stepCount: steps.stepCount,
          lastStepId: steps.lastStepId,
          lastStepStatus: steps.lastStatus,
        }
      }),
      limit,
    })
  } catch (error) {
    console.error('GET /api/bot-control/pipeline/runs gagal', error)
    return NextResponse.json({ error: 'Gagal memuat daftar run pipeline' }, { status: 500 })
  }
}
