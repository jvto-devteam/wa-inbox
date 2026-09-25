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

function isConversationsResponse(value: unknown): value is ConversationsResponse {
  return typeof value === 'object' && value !== null
}

/**
 * Cari nama tampilan pengirim Messenger lewat participants percakapan Page.
 *
 * Endpoint profil langsung (`GET /{psid}?fields=name`) DITOLAK Graph API (code 100, "does
 * not exist, cannot be loaded due to missing permissions") -- terverifikasi di produksi.
 * Endpoint yang benar-benar bekerja adalah percakapan Page ini:
 * `GET /{page_id}/conversations?user_id={psid}&fields=participants`. Pengirimnya adalah
 * participant yang id-nya BUKAN page id.
 *
 * SELALU mengembalikan `null`, tidak pernah melempar -- error jaringan, error Graph, token
 * hilang, atau bentuk respons yang tak terduga semuanya ditelan di sini. Pemanggil
 * (`inbound-messenger.ts`) memakai hasil ini hanya untuk mengisi nama; pesan pelanggan itu
 * sendiri wajib tetap masuk ke Inbox walau pencarian nama gagal total.
 *
 * Token TIDAK PERNAH ikut ke log atau ke nilai balik -- baik lewat sukses maupun lewat jalur
 * gagal manapun di fungsi ini (lihat pola yang sama di messenger-send.ts).
 */
export async function fetchMessengerProfileName(psid: string): Promise<string | null> {
  const token = process.env.FB_PAGE_ACCESS_TOKEN
  if (!token) return null

  const pageId = process.env.FB_PAGE_ID || DEFAULT_PAGE_ID

  try {
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${pageId}/conversations?user_id=${psid}&fields=participants&access_token=${token}`,
      { signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS) },
    )

    if (!res.ok) return null

    const data: unknown = await res.json()
    if (!isConversationsResponse(data)) return null

    const participants = data.data?.[0]?.participants?.data
    if (!participants) return null

    const sender = participants.find((participant) => participant.id && participant.id !== pageId)
    return sender?.name ?? null
  } catch {
    return null
  }
}
