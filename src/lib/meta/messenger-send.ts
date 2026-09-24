const GRAPH_VERSION = 'v21.0'

/**
 * Kirim pesan teks ke satu PSID lewat Graph API Page.
 *
 * Pesan error dari Meta TIDAK pernah diteruskan mentah-mentah: Meta memantulkan token yang
 * dipakai ke dalam teks error OAuth-nya, dan teks itu bisa mendarat di UI atau audit log.
 * CLAUDE.md §5 melarang token muncul di mana pun.
 */
export async function sendMessengerText(
  recipientId: string,
  text: string,
): Promise<{ externalId: string }> {
  const token = process.env.FB_PAGE_ACCESS_TOKEN
  if (!token) throw new Error('FB_PAGE_ACCESS_TOKEN belum diatur')

  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/me/messages?access_token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: { id: recipientId },
      message: { text },
      messaging_type: 'RESPONSE',
    }),
  })

  const data: unknown = await res.json()

  if (!res.ok) {
    const code = (data as { error?: { code?: number } }).error?.code
    // Code 10 = di luar jendela 24 jam. Mencoba lagi tidak akan pernah berhasil, jadi
    // agen harus tahu alasannya alih-alih menekan tombol kirim berulang kali.
    if (code === 10) {
      throw new Error('Facebook menolak: sudah lewat 24 jam sejak pesan terakhir pelanggan')
    }
    throw new Error(`Gagal mengirim ke Facebook (code ${code ?? res.status})`)
  }

  const messageId = (data as { message_id?: string }).message_id
  if (!messageId) throw new Error('Facebook tidak mengembalikan message_id')

  return { externalId: messageId }
}
