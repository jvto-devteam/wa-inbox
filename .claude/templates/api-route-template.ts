/**
 * TEMPLATE: API route standar wa-inbox.
 *
 * Salin file ini ke `src/app/api/<area>/<resource>/route.ts`, lalu ganti bagian bertanda
 * TODO. File ini sengaja ditulis agar tetap lolos `tsc --noEmit` dan `eslint` apa adanya,
 * supaya template yang rusak ketahuan sebelum dipakai — bukan setelah disalin.
 *
 * Aturan yang WAJIB ikut tersalin (lihat CLAUDE.md §2 dan §6):
 *
 * 1. Error response SELALU berbentuk `{ error: string }` — tidak pernah string telanjang,
 *    tidak pernah `{ message }`, tidak pernah array kosong yang menyamar sebagai sukses.
 * 2. Status: 400 validasi, 401 tanpa sesi, 403 role kurang, 404 tidak ditemukan,
 *    409 konflik, 500 kegagalan tak terduga.
 * 3. Route yang mengubah state / menjalankan proses mahal = ADMIN (`requireAdmin`).
 *    Route baca-saja cukup sesi (`getSession`) — AGENT read-only.
 * 4. Body POST/PATCH divalidasi Zod lewat `parseJsonBody`, tidak pernah `await req.json()`
 *    mentah: body non-JSON dari klien akan melempar dan menjadi 500 tanpa helper ini.
 * 5. Query param dibaca lewat `new URL(req.url).searchParams`, di-clamp, dan difilter di
 *    level database (`where`), bukan di JavaScript setelah `take` — filter setelah take
 *    berarti "N baris terbaru, yang kebetulan cocok", yang bisa kosong padahal datanya ada.
 * 6. Tidak pernah mengembalikan secret (token, app secret, credential) ke klien.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth/get-session'
import { requireAdmin } from '@/lib/auth/require-admin'
import { parseJsonBody } from '@/lib/parse-json'

// Batas paging dipusatkan supaya GET dan test membaca angka yang sama.
const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

/** Membaca `page`/`limit` dengan clamp — `?limit=100000` tidak boleh menjadi query tak terbatas. */
function readPaging(url: URL): { page: number; limit: number; skip: number } {
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1)
  const rawLimit = Number(url.searchParams.get('limit')) || DEFAULT_LIMIT
  const limit = Math.min(MAX_LIMIT, Math.max(1, rawLimit))
  return { page, limit, skip: (page - 1) * limit }
}

/**
 * GET — baca-saja, terbuka untuk setiap user yang punya sesi (ADMIN dan AGENT).
 *
 * `getSession` dipakai (bukan `requireAdmin`) karena guidebook §19 mensyaratkan AGENT bisa
 * membaca area Bot Control. Middleware sudah menolak request tanpa sesi sebelum sampai sini;
 * pengecekan ulang tetap ada supaya route ini tidak bergantung pada konfigurasi middleware
 * kalau suatu saat path-nya berpindah.
 */
export async function GET(req: Request) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 })

  const url = new URL(req.url)
  const { page, limit, skip } = readPaging(url)
  const q = url.searchParams.get('q')?.trim() || undefined

  try {
    // TODO: ganti dengan query Prisma sungguhan. Filter dibangun sebagai objek `where`
    // supaya jumlah total dan halaman dihitung dari himpunan yang sama.
    const items: unknown[] = []
    const total = 0
    void q
    void skip

    return NextResponse.json({ items, page, limit, total })
  } catch (error) {
    // Detail error masuk ke log server, bukan ke klien: pesan Prisma bisa membocorkan
    // nama kolom, host database, dan potongan query.
    console.error('GET /api/<area>/<resource> gagal', error)
    return NextResponse.json({ error: 'Gagal memuat data' }, { status: 500 })
  }
}

// Skema body dideklarasikan di module scope, bukan di dalam handler: dipakai ulang oleh
// route test supaya test memvalidasi kontrak yang sama persis dengan runtime.
const postSchema = z.object({
  key: z.string().min(1),
  note: z.string().max(500).optional(),
})

/**
 * POST — mengubah state, jadi ADMIN saja.
 *
 * `requireAdmin` mengembalikan null untuk "tidak ada sesi" DAN "sesi AGENT". Keduanya dijawab
 * 403 dengan pesan yang menyebut peran, mengikuti pola route admin existing
 * (`src/app/api/templates/route.ts`).
 */
export async function POST(req: Request) {
  const admin = await requireAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Hanya admin yang bisa melakukan aksi ini' }, { status: 403 })

  // parseJsonBody menangani DUA kegagalan sekaligus: body yang bukan JSON sama sekali
  // (`req.json()` melempar sebelum Zod pernah jalan) dan JSON yang tidak lolos skema.
  // Keduanya dijawab 400 dengan pesan yang sama — dari sisi klien itu kesalahan yang sama.
  const parsed = await parseJsonBody(req, postSchema, 'Data tidak valid')
  if (!parsed.success) return NextResponse.json({ error: parsed.error }, { status: 400 })

  try {
    // TODO: aksi sungguhan. `parsed.data` sudah bertipe hasil inferensi Zod — jangan
    // di-cast ke `any`, dan jangan baca field yang tidak ada di skema.
    return NextResponse.json({ ok: true, key: parsed.data.key })
  } catch (error) {
    console.error('POST /api/<area>/<resource> gagal', error)
    return NextResponse.json({ error: 'Gagal menyimpan data' }, { status: 500 })
  }
}

/**
 * Route dinamis (`[id]/route.ts`) — di Next.js 16 `params` adalah Promise dan WAJIB di-await.
 * Membacanya sebagai objek biasa lolos di editor tapi gagal saat build.
 *
 * export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
 *   const { id } = await params
 *   ...
 *   if (!row) return NextResponse.json({ error: 'Data tidak ditemukan' }, { status: 404 })
 * }
 */
