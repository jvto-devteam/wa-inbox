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
 * `include` juga diganti `select`: yang dikirim ke klien hanya enam field, jadi menarik baris
 * percakapan utuh (termasuk `bookingData`, kolom Json yang bisa besar) adalah pemborosan yang
 * tidak pernah terlihat di layar.
 *
 * --- Urutan ---
 *
 * Yang terakhir menghubungi lebih dulu. Kontak tanpa percakapan (belum pernah ada pesan)
 * jatuh ke belakang lewat `nulls: 'last'`, bukan menyumbat halaman pertama.
 *
 * --- Auth ---
 *
 * Route ini SEBELUMNYA tidak punya cek auth sama sekali: siapa pun yang bisa mencapai
 * URL-nya mendapat nama dan nomor telepon seluruh pelanggan JVTO. Sekarang butuh sesi.
 * Sengaja `getSession`, bukan `requireAdmin` — agen memang perlu membuka daftar kontak.
 */
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

  const where: Prisma.ContactWhereInput = {}
  if (stage || labelId) where.conversation = conversationFilter
  if (q) {
    // Nama ATAU nomor. `mode: 'insensitive'` supaya "bruno" menemukan "Bruno", dan `contains`
    // supaya potongan nomor ("4478") menemukan nomor lengkapnya -- operator jarang mengetik
    // nomor utuh berikut kode negaranya.
    //
    // Dicari di DATABASE, bukan disaring di klien: hasilnya berhalaman, jadi penyaringan di
    // klien hanya akan mencari di dalam 50 baris yang kebetulan sedang tampil dan melaporkan
    // "tidak ditemukan" untuk kontak yang sebenarnya ada di halaman lain.
    where.OR = [
      { name: { contains: q, mode: 'insensitive' } },
      { phone: { contains: q } },
    ]
  }

  // `count` memakai `where` yang sama persis dengan `findMany`. Kalau keduanya berbeda,
  // penomoran halamannya berbohong — "Halaman 3 dari 7" yang halaman ketujuhnya kosong.
  const [total, contacts] = await Promise.all([
    prisma.contact.count({ where }),
    prisma.contact.findMany({
      where,
      select: {
        id: true,
        name: true,
        phone: true,
        conversation: {
          select: {
            // `id` dikirim supaya tombol "Chat" di tabel bisa membuka percakapan yang tepat.
            // Inbox memilih percakapan lewat `?conversation=<id percakapan>`, bukan id kontak.
            id: true,
            pipelineStage: true,
            // Disimpan sekali saat data booking pertama kali terbaca dan tidak pernah ditimpa
            // (lihat komentar kolomnya di schema.prisma). NULL berarti belum ketahuan, bukan
            // "tidak punya" — tabelnya menampilkannya sebagai "-", bukan menebak.
            orderChannel: true,
            lastMessageAt: true,
            labels: { select: { label: { select: { name: true } } } },
          },
        },
      },
      // Diurut lewat relasi, jadi Prisma hanya menerima arah — bukan kontrol `nulls`. Kontak
      // tanpa percakapan karena itu bisa jatuh di awal, bukan di akhir. Diterima: setiap kontak
      // lahir dari pesan masuk pertamanya (lihat ingestSingleMessage), jadi kontak tanpa
      // percakapan praktis tidak ada. `createdAt` jadi pemutus supaya urutannya tetap stabil
      // antar-halaman — dua baris dengan lastMessageAt sama tidak boleh bertukar tempat saat
      // pindah halaman, karena itu membuat satu baris terlewat dan satu lagi muncul dua kali.
      orderBy: [{ conversation: { lastMessageAt: 'desc' } }, { createdAt: 'desc' }],
      skip,
      take: limit,
    }),
  ])

  return NextResponse.json({
    rows: contacts.map((c) => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
      conversationId: c.conversation?.id ?? null,
      orderChannel: c.conversation?.orderChannel ?? null,
      pipelineStage: c.conversation?.pipelineStage ?? 'new',
      lastContactAt: c.conversation?.lastMessageAt?.toISOString() ?? null,
      labels: c.conversation?.labels.map((l) => l.label.name) ?? [],
    })),
    total,
    page,
    limit,
  })
}
