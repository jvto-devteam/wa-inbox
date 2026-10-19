/**
 * Tautan ke satu percakapan di Inbox, opsional dengan pesan yang disorot. Modul sendiri supaya
 * SummaryQueue dan QuestionList bisa saling memakai tanpa impor melingkar; SummaryQueue
 * mengekspornya ulang untuk pemakai lama.
 *
 * `lihat`: pesan hanya digulung dan disorot, panel "Perbaiki jawaban bot" tidak dibuka sendiri
 * (`&lihat=1`, dibaca inbox/page.tsx). Dipakai butir ringkasan dan janji tim; Balas dan lonceng
 * gap tanpa ini.
 */
export function conversationHref(conversationId: string, messageId?: string | null, opts: { lihat?: boolean } = {}): string {
  const base = `/inbox?conversation=${encodeURIComponent(conversationId)}`
  if (!messageId) return base
  return `${base}&message=${encodeURIComponent(messageId)}${opts.lihat ? '&lihat=1' : ''}`
}
