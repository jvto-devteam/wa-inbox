import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth/get-session'
import { FUNNEL_STAGES, resolveFunnelStage, type FunnelStage } from '@/lib/pipeline/funnel'

/**
 * GET /api/bot-control/pipeline/funnel — sebaran percakapan per tahap funnel penjualan.
 *
 * --- Kenapa dihitung di sini dan bukan di browser ---
 *
 * Tahapnya diturunkan dari `Conversation.tripBrief`, sebuah kolom Json bebas berisi catatan
 * perjalanan pelanggan. Menghitung di server berarti yang menyeberang ke tab operator hanyalah
 * enam angka, bukan ratusan brief mentah. Yang menghitung tetap `resolveFunnelStage` yang sama
 * persis — satu tangga, satu definisi. UI tidak boleh punya salinan aturannya sendiri, karena
 * dua definisi tahap yang berdampingan pasti akan berbeda suatu hari.
 *
 * --- Dari mana "sudah diserahkan ke manusia" dibaca ---
 *
 * `funnel.ts` sengaja tidak memutuskan itu sendiri (lihat header modulnya) dan meminta
 * pemanggil menentukan sumbernya. Di sini sumbernya `botEnabled === false`, salah satu dari dua
 * opsi yang disebut modul itu: `runBotForConversation` mematikan kolom itu setiap kali handoff
 * terjadi. Konsekuensinya jujur dan disebut di UI: percakapan yang bot-nya dimatikan MANUAL
 * oleh agent juga terhitung "diteruskan" — dan memang itulah yang terjadi pada percakapan itu,
 * meski bukan bot yang memutuskannya.
 *
 * --- Kenapa ada jendela ---
 *
 * Funnel adalah gambaran keadaan sekarang, bukan sejarah sejak awal waktu. Membaca seluruh
 * tabel percakapan akan tumbuh tanpa batas untuk satu baris angka yang tidak berubah artinya.
 * Jendelanya disebutkan di response supaya angkanya tidak pernah dibaca sebagai "total
 * seluruh bisnis".
 */

const WINDOW_SIZE = 500

export async function GET(req: Request) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 })

  try {
    const conversations = await prisma.conversation.findMany({
      // Percakapan sandbox bukan pelanggan; memasukkannya berarti funnel penjualan yang
      // menghitung latihan sebagai prospek.
      where: { isTest: false },
      orderBy: { lastMessageAt: 'desc' },
      take: WINDOW_SIZE,
      select: { id: true, tripBrief: true, botEnabled: true },
    })

    const counts = new Map<FunnelStage, number>(FUNNEL_STAGES.map((stage) => [stage.id, 0]))
    for (const conversation of conversations) {
      const stage = resolveFunnelStage({
        tripBrief: conversation.tripBrief,
        handedOff: conversation.botEnabled === false,
      })
      counts.set(stage, (counts.get(stage) ?? 0) + 1)
    }

    return NextResponse.json({
      // Urutan tangga datang dari FUNNEL_STAGES, jadi UI tidak perlu tahu urutannya sendiri.
      //
      // Yang dikirim hanya id dan angka. Label dan penjelasan tiap tahap TIDAK ikut: keduanya
      // sudah ada di `funnel.ts`, yang aman diimpor klien karena modulnya murni. Mengirimnya
      // dari sini akan membuat dua salinan teks yang sama, dan yang di layar bukan lagi yang
      // di modul.
      stages: FUNNEL_STAGES.map((stage) => ({ id: stage.id, count: counts.get(stage.id) ?? 0 })),
      total: conversations.length,
      windowSize: WINDOW_SIZE,
    })
  } catch (error) {
    console.error('GET /api/bot-control/pipeline/funnel gagal', error)
    return NextResponse.json({ error: 'Gagal memuat sebaran funnel' }, { status: 500 })
  }
}
