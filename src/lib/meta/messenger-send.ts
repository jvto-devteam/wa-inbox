const GRAPH_VERSION = 'v21.0'

const PLATFORM_NAMA: Record<'FACEBOOK' | 'INSTAGRAM', string> = {
  FACEBOOK: 'Facebook',
  INSTAGRAM: 'Instagram',
}

/**
 * Kirim pesan teks ke satu PSID (Facebook) atau IGSID (Instagram) lewat Graph API Page.
 *
 * Endpoint dan token-nya SAMA untuk kedua platform -- `POST /me/messages` dengan Page
 * Access Token -- karena akun Instagram Professional-nya tertaut ke Page yang sama. Ini
 * jalur "Page-linked", bukan "Instagram API with Instagram Login" (graph.instagram.com),
 * yang punya endpoint sendiri dan TIDAK dipakai di sini.
 *
 * Dua hal yang tetap berbeda:
 * 1. `messaging_type` hanya dikirim untuk Facebook. Dokumentasi kirim Instagram tidak
 *    menyertakannya, dan mengirim field yang tidak dikenal ke Graph API berisiko ditolak.
 * 2. Nama platform di pesan error. "Facebook menolak" pada percakapan Instagram membuat
 *    agen mencari masalah di tempat yang salah.
 *
 * Pesan error dari Meta TIDAK pernah diteruskan mentah-mentah: Meta memantulkan token yang
 * dipakai ke dalam teks error OAuth-nya, dan teks itu bisa mendarat di UI atau audit log.
 * CLAUDE.md §5 melarang token muncul di mana pun.
 */
export async function sendMessengerText(
  recipientId: string,
  text: string,
  platform: 'FACEBOOK' | 'INSTAGRAM',
): Promise<{ externalId: string }> {
  const nama = PLATFORM_NAMA[platform]

  // DUA SISTEM, bukan satu API dengan dua endpoint -- sama seperti di messenger-profile.ts.
  // Instagram DM masuk lewat jalur "Instagram API with Instagram login", jadi balasannya
  // WAJIB keluar lewat jalur yang sama: host `graph.instagram.com` dengan token akun
  // Instagram. IGSID yang kita terima hanya berarti di sistem itu; mengirimnya ke
  // graph.facebook.com dengan Page token ditolak, karena id-nya tidak dikenal di sana.
  const instagram = platform === 'INSTAGRAM'
  const host = instagram ? 'graph.instagram.com' : 'graph.facebook.com'
  const envVar = instagram ? 'IG_USER_TOKEN' : 'FB_PAGE_ACCESS_TOKEN'
  const token = instagram ? process.env.IG_USER_TOKEN : process.env.FB_PAGE_ACCESS_TOKEN
  if (!token) throw new Error(`${envVar} belum diatur`)

  const res = await fetch(`https://${host}/${GRAPH_VERSION}/me/messages?access_token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: { id: recipientId },
      message: { text },
      ...(platform === 'FACEBOOK' ? { messaging_type: 'RESPONSE' } : {}),
    }),
  })

  const data: unknown = await res.json()

  if (!res.ok) {
    const code = (data as { error?: { code?: number } }).error?.code
    // Code 10 = di luar jendela 24 jam, berlaku sama untuk Messenger dan Instagram DM.
    // Mencoba lagi tidak akan pernah berhasil, jadi agen harus tahu alasannya alih-alih
    // menekan tombol kirim berulang kali. Sengaja TIDAK bercabang pada subcode: subcode
    // varian Instagram tidak bisa dikonfirmasi dari dokumentasi resmi yang bisa diakses.
    if (code === 10) {
      throw new Error(`${nama} menolak: sudah lewat 24 jam sejak pesan terakhir pelanggan`)
    }
    throw new Error(`Gagal mengirim ke ${nama} (code ${code ?? res.status})`)
  }

  const messageId = (data as { message_id?: string }).message_id
  if (!messageId) throw new Error(`${nama} tidak mengembalikan message_id`)

  return { externalId: messageId }
}
