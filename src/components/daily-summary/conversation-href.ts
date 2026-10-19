/**
 * Tautan ke satu percakapan di Inbox, opsional dengan pesan yang disorot. Modul sendiri supaya
 * SummaryQueue dan QuestionList bisa saling memakai tanpa impor melingkar; SummaryQueue
 * mengekspornya ulang untuk pemakai lama.
 *
 * `lihat`: pesan hanya digulung dan disorot, panel "Perbaiki jawaban bot" tidak dibuka sendiri
 * (`&lihat=1`, dibaca inbox/page.tsx). Dipakai butir ringkasan dan janji tim; Balas dan lonceng
 * gap tanpa ini.
 *
 * `draft`: Balas dari antrean (`&draft=1`) -- Inbox menyusun draft untuk pesan yang disorot,
 * sekali, dan hanya menampilkannya. Tanpa pesan sorot parameter ini tidak berarti apa-apa, jadi
 * tidak ditulis.
 *
 * `followup`: Follow up dari antrean (`&followup=1`) -- Inbox membuka pemilih template kalau
 * jendela layanan sudah tertutup, atau memfokuskan kotak balasan kalau belum. Tidak butuh pesan
 * sorot. Keduanya tidak pernah mengirim apa pun; kirim tetap klik operator.
 */
export function conversationHref(
  conversationId: string,
  messageId?: string | null,
  opts: { lihat?: boolean; draft?: boolean; followup?: boolean } = {}
): string {
  let href = `/inbox?conversation=${encodeURIComponent(conversationId)}`
  if (messageId) {
    href += `&message=${encodeURIComponent(messageId)}`
    if (opts.lihat) href += '&lihat=1'
    if (opts.draft) href += '&draft=1'
  }
  if (opts.followup) href += '&followup=1'
  return href
}
