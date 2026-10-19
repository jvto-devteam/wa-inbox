// Murni, aman untuk klien. Memilih pesan yang dijawab draft otomatis saat operator tiba dari
// "Balas" di antrean /summary (`&draft=1`).

type ThreadMessage = { id: string; direction: string; type?: string; content?: string | null }

/**
 * Pesan teks yang bisa dibuatkan draft. `type` hilang di fixture lama berarti pesan teks biasa --
 * tapi kalau ADA dan bukan 'text' (gambar/video/dokumen berkaption, yang tetap punya `content`),
 * tidak. Bot produksi hanya pernah menjawab `type === 'text'` (src/lib/inbound.ts), dan
 * `loadSourceMessage` di message-draft.ts menolak sisanya dengan 400.
 */
export function isDraftableText(message: { type?: string; content?: string | null }): boolean {
  return (message.type === undefined || message.type === 'text') && Boolean(message.content?.trim())
}

export type AutoDraftTarget =
  | { kind: 'target'; messageId: string }
  /** Run pesan masuk mulai dari pesan fokus tidak berisi satu pun pesan teks. */
  | { kind: 'no-text' }
  /** Pesan fokus tidak ada di thread, atau bukan pesan masuk. */
  | { kind: 'none' }

/**
 * Anchor item REPLY adalah pesan masuk PERTAMA dari rangkaian yang belum dijawab ("Halo" pukul
 * 10.00), padahal yang perlu dijawab biasanya yang TERAKHIR (pertanyaan harga pukul 10.40) --
 * draft untuk pesan pertama juga hanya melihat riwayat sebelum pesan itu. Jadi targetnya pesan
 * teks INBOUND terakhir dalam run yang dimulai di pesan fokus, berhenti di OUTBOUND berikutnya.
 */
export function autoDraftTarget(messages: ReadonlyArray<ThreadMessage>, focusMessageId: string): AutoDraftTarget {
  const start = messages.findIndex((m) => m.id === focusMessageId)
  if (start === -1 || messages[start].direction !== 'INBOUND') return { kind: 'none' }
  let target: string | null = null
  for (let i = start; i < messages.length && messages[i].direction === 'INBOUND'; i++) {
    if (isDraftableText(messages[i])) target = messages[i].id
  }
  return target ? { kind: 'target', messageId: target } : { kind: 'no-text' }
}
