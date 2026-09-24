import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth/get-session'
import { readPaging } from '@/lib/bot-control/paging'

/**
 * GET /api/contacts — daftar kontak, berhalaman.
 *
 * --- Kenapa berhalaman, dan kenapa itu bukan sekadar kerapian ---
 *
 * Sebelumnya route ini `findMany` tanpa `take` sama sekali, dengan `include` bersarang dua
 * tingkat (conversation -> labels -> label). Artinya SETIAP pembukaan halaman Kontak menarik
 * seluruh tabel kontak beserta percakapan dan seluruh labelnya — 340 kontak hari ini, dan
 * tumbuh setiap ada orang baru yang mengirim pesan. Tidak ada batas atas.
 *
 * `select` dipakai, bukan `include`: yang dikirim ke klien hanya enam field, jadi menarik baris
 * percakapan utuh (termasuk `bookingData`, kolom Json yang bisa besar) adalah pemborosan yang
 * tidak pernah terlihat di layar.
 *
 * --- Dua tier, sejak Task 9 ---
 *
 * `Conversation.contactId` dilonggarkan dari `@unique` (satu Contact boleh punya banyak
 * Conversation), jadi Prisma tidak lagi bisa mengurutkan Contact lewat field anak relasinya
 * (`orderBy: { conversation: { lastMessageAt: 'desc' } }` -- Prisma hanya mendukung `_count`
 * untuk orderBy pada relasi ke-banyak, bukan field seperti `lastMessageAt`). Query karena itu
 * dipecah dua:
 *
 * - Tier 1: kontak TANPA percakapan sama sekali. Diurutkan oleh `createdAt`, ditaruh DI DEPAN
 *   -- mempertahankan perilaku lama, yang menaruh kontak tanpa percakapan di awal lewat efek
 *   samping orderBy relasi Prisma.
 *
 *   Tier ini BUKAN kasus kosong, tapi alasannya bukan yang pernah ditulis di sini. Template
 *   sistem (src/lib/system-templates/send.ts) TIDAK membuat Contact untuk nomor internal/crew:
 *   cabang INTERNAL dan cabang grup di sana meng-enqueue dengan `contactId: null` dan tidak
 *   pernah menyentuh tabel Contact sama sekali; hanya cabang CUSTOMER yang membuat Contact, dan
 *   cabang itu selalu membuat Conversation juga. Yang benar-benar mendarat di tier ini adalah
 *   Contact yatim dari balapan kontak ganda (Temuan I-4/I-5): dua pesan pertama yang nyaris
 *   bersamaan dari nomor baru yang sama membuat dua Contact, identitasnya hanya terikat ke
 *   salah satu, dan yang lain tinggal tanpa percakapan. Tanpa tier 1 kontak seperti itu hilang
 *   sama sekali dari halaman Kontak -- tak terlihat, tak bisa digabungkan, tak bisa dibersihkan.
 * - Tier 2: kontak DENGAN percakapan, sumbernya `Conversation.findMany` (bukan `Contact`),
 *   diurut langsung oleh `Conversation.lastMessageAt` -- field asli, bukan lewat relasi, jadi
 *   tidak kena batasan di atas. Kontak dengan lebih dari satu percakapan (channel non-WhatsApp,
 *   belum ada di produksi) akan muncul sebagai BARIS TERPISAH per percakapan -- ini disengaja:
 *   pipelineStage/labels ada di Conversation, bukan Contact, dan tombol "Chat" di tabel perlu
 *   tahu percakapan MANA yang dibuka.
 *
 * Filter `stage`/`labelId` hidup di Conversation, jadi tidak pernah cocok kontak tier 1 -- sama
 * seperti perilaku sebelum Task 9.
 *
 * --- Auth ---
 *
 * Route ini SEBELUMNYA tidak punya cek auth sama sekali: siapa pun yang bisa mencapai
 * URL-nya mendapat nama dan nomor telepon seluruh pelanggan JVTO. Sekarang butuh sesi.
 * Sengaja `getSession`, bukan `requireAdmin` — agen memang perlu membuka daftar kontak.
 */
type ContactRow = {
  id: string
  name: string | null
  phone: string | null
  conversationId: string | null
  orderChannel: string | null
  pipelineStage: string
  lastContactAt: string | null
  labels: string[]
}

export async function GET(req: Request) {
  const session = await getSession(req)
  if (!session) {
    return NextResponse.json({ error: 'Silakan masuk lebih dulu' }, { status: 401 })
  }

  const url = new URL(req.url)
  const stage = url.searchParams.get('stage')
  const labelId = url.searchParams.get('labelId')
  const q = url.searchParams.get('q')?.trim() ?? ''
  const { page, limit, skip } = readPaging(url)

  const conversationFilter: Prisma.ConversationWhereInput = {}
  if (stage) conversationFilter.pipelineStage = stage
  if (labelId) conversationFilter.labels = { some: { labelId } }
  const hasConversationFilter = Boolean(stage || labelId)

  // Nama ATAU nomor. `mode: 'insensitive'` supaya "bruno" menemukan "Bruno", dan `contains`
  // supaya potongan nomor ("4478") menemukan nomor lengkapnya -- operator jarang mengetik
  // nomor utuh berikut kode negaranya.
  //
  // Dicari di DATABASE, bukan disaring di klien: hasilnya berhalaman, jadi penyaringan di
  // klien hanya akan mencari di dalam 50 baris yang kebetulan sedang tampil dan melaporkan
  // "tidak ditemukan" untuk kontak yang sebenarnya ada di halaman lain.
  const contactSearch: Prisma.ContactWhereInput = q
    ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { phone: { contains: q } }] }
    : {}

  const conversationWhere: Prisma.ConversationWhereInput = {
    ...conversationFilter,
    ...(q ? { contact: contactSearch } : {}),
  }

  // Filter stage/labelId hidup di Conversation -- kontak tanpa percakapan tidak pernah cocok,
  // jadi tier 1 kosong (bukan diquery) saat salah satunya aktif.
  const noConversationWhere: Prisma.ContactWhereInput | null = hasConversationFilter
    ? null
    : { ...contactSearch, conversations: { none: {} } }

  const [conversationTotal, noConversationTotal] = await Promise.all([
    prisma.conversation.count({ where: conversationWhere }),
    noConversationWhere ? prisma.contact.count({ where: noConversationWhere }) : Promise.resolve(0),
  ])
  const total = conversationTotal + noConversationTotal

  const rows: ContactRow[] = []
  let remainingSkip = skip
  let remainingTake = limit

  if (noConversationWhere && remainingTake > 0 && remainingSkip < noConversationTotal) {
    const tier1 = await prisma.contact.findMany({
      where: noConversationWhere,
      select: { id: true, name: true, phone: true },
      orderBy: { createdAt: 'desc' },
      skip: remainingSkip,
      take: Math.min(remainingTake, noConversationTotal - remainingSkip),
    })
    rows.push(
      ...tier1.map((c) => ({
        id: c.id,
        name: c.name,
        phone: c.phone,
        conversationId: null,
        orderChannel: null,
        pipelineStage: 'new',
        lastContactAt: null,
        labels: [],
      })),
    )
  }
  remainingSkip = Math.max(0, remainingSkip - noConversationTotal)
  remainingTake = limit - rows.length

  if (remainingTake > 0) {
    const tier2 = await prisma.conversation.findMany({
      where: conversationWhere,
      select: {
        id: true,
        pipelineStage: true,
        orderChannel: true,
        lastMessageAt: true,
        contact: { select: { id: true, name: true, phone: true } },
        labels: { select: { label: { select: { name: true } } } },
      },
      // `createdAt` sebagai pemutus supaya urutannya tetap stabil antar-halaman -- dua baris
      // dengan lastMessageAt sama tidak boleh bertukar tempat saat pindah halaman, karena itu
      // membuat satu baris terlewat dan satu lagi muncul dua kali.
      orderBy: [{ lastMessageAt: 'desc' }, { createdAt: 'desc' }],
      skip: remainingSkip,
      take: remainingTake,
    })
    rows.push(
      ...tier2.map((conv) => ({
        id: conv.contact.id,
        name: conv.contact.name,
        phone: conv.contact.phone,
        conversationId: conv.id,
        orderChannel: conv.orderChannel,
        pipelineStage: conv.pipelineStage,
        lastContactAt: conv.lastMessageAt.toISOString(),
        labels: conv.labels.map((l) => l.label.name),
      })),
    )
  }

  return NextResponse.json({ rows, total, page, limit })
}
