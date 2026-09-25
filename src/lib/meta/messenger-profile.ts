const GRAPH_VERSION = 'v21.0'

// Batas waktu pencarian nama. Webhook Meta di-retry kalau balasan kita terlalu lama --
// timeout eksplisit ini mencegah Graph API yang lambat menggantung pemrosesan webhook dan
// memicu duplikasi (lihat CLAUDE.md §9 pola "verifikasi sebelum menyatakan": ini diverifikasi
// perlu karena Meta memang retry on timeout, bukan diasumsikan).
const LOOKUP_TIMEOUT_MS = 5000

// Page id JVTO di Facebook. `FB_PAGE_ID` terverifikasi TIDAK dideklarasikan di mana pun di
// kode atau .env lokal per audit 2026-09-23 -- env var VPS boleh saja mengaturnya (dan kalau
// diatur, itu yang dipakai), tapi kalau tidak, nilai ini yang dipakai supaya pencarian nama
// tidak diam-diam mati hanya karena env var yang tidak pernah ditambahkan. Diverifikasi hidup
// di produksi 2026-09-23 lewat panggilan Graph API manual sebelum fitur ini dibangun.
const DEFAULT_PAGE_ID = '698402510359502'

interface ConversationsResponse {
  data?: Array<{
    participants?: {
      data?: Array<{ id?: string; name?: string }>
    }
  }>
}

interface InstagramProfileResponse {
  name?: string
  username?: string
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Cari nama tampilan pengirim Messenger atau Instagram DM.
 *
 * Dua cabang, karena Graph API memperlakukan keduanya BERBEDA -- bukan karena kerapian:
 *
 * - FACEBOOK: `GET /{psid}?fields=name` DITOLAK (code 100, terverifikasi di produksi
 *   2026-09-23). Satu-satunya jalan adalah `GET /{page_id}/conversations?user_id={psid}
 *   &fields=participants`, lalu ambil participant yang id-nya BUKAN page id.
 * - INSTAGRAM: endpoint profil langsung JUSTRU bekerja --
 *   `GET /{igsid}?fields=name,username`. Akun Instagram boleh tidak punya `name`
 *   (hanya username), jadi `username` dipakai sebagai cadangan.
 *
 * `platform` WAJIB dan tanpa default. Default apa pun di sini akan salah untuk separuh
 * pemanggil dan gagal secara senyap: kontak lahir tanpa nama, tidak ada error, tidak ada
 * yang melapor. Bandingkan dengan `platform` opsional di src/lib/send.ts yang sudah
 * dibatalkan pada Review round 1 Temuan 1 karena persis alasan ini.
 *
 * SELALU mengembalikan `null`, tidak pernah melempar -- error jaringan, error Graph, token
 * hilang, atau bentuk respons tak terduga semuanya ditelan di sini. Pesan pelanggan wajib
 * tetap masuk ke Inbox walau pencarian nama gagal total.
 *
 * Token TIDAK PERNAH ikut ke log maupun ke nilai balik, lewat jalur sukses maupun gagal.
 */
export async function fetchMessengerProfileName(
  externalId: string,
  platform: 'FACEBOOK' | 'INSTAGRAM',
): Promise<string | null> {
  const token = process.env.FB_PAGE_ACCESS_TOKEN
  if (!token) return null

  // Dihitung SEKALI, dipakai di dua tempat di bawah (membangun URL Page dan memfilter
  // participant yang BUKAN page id). Kalau suatu saat hanya salah satu diedit, `find()` di
  // bawah diam-diam mengembalikan Page-nya sendiri dan setiap kontak Facebook lahir bernama
  // nama Page, tanpa error -- lihat review round 2 Temuan 4.
  const pageId = process.env.FB_PAGE_ID || DEFAULT_PAGE_ID

  const url =
    platform === 'INSTAGRAM'
      ? `https://graph.facebook.com/${GRAPH_VERSION}/${externalId}?fields=${encodeURIComponent('name,username')}&access_token=${token}`
      : `https://graph.facebook.com/${GRAPH_VERSION}/${pageId}/conversations?user_id=${externalId}&fields=participants&access_token=${token}`

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS) })
    if (!res.ok) {
      // Non-fatal: pencarian gagal, kontak tetap lahir tanpa nama (lihat try/catch pemanggil
      // di inbound-messenger.ts). Log ini adalah satu-satunya jejak yang membedakan "izin
      // token belum ada" (mis. instagram_basic belum di-grant) dari "akun memang tidak
      // punya nama" -- tanpanya keduanya terlihat identik dari Inbox. HANYA status HTTP dan
      // platform, TIDAK PERNAH `url` (mengandung access_token) atau `token` itu sendiri.
      console.warn('fetchMessengerProfileName: pencarian gagal', { platform, status: res.status })
      return null
    }

    const data: unknown = await res.json()
    if (!isObject(data)) return null

    if (platform === 'INSTAGRAM') {
      const profile = data as InstagramProfileResponse
      return profile.name ?? profile.username ?? null
    }

    const participants = (data as ConversationsResponse).data?.[0]?.participants?.data
    if (!participants) return null

    const sender = participants.find((participant) => participant.id && participant.id !== pageId)
    return sender?.name ?? null
  } catch {
    // Non-fatal juga di sini (timeout, error jaringan, JSON tak terduga) -- tidak ada
    // `res.status` yang valid pada jalur ini, jadi log hanya membawa `platform`. TIDAK
    // PERNAH `url` atau `token`.
    console.warn('fetchMessengerProfileName: pencarian melempar error', { platform })
    return null
  }
}
