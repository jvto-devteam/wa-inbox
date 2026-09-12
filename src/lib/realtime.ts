type RealtimeEvent =
  | { type: 'message.created'; conversationId: string; message: unknown }
  // An existing message row changed in place -- currently only Meta delivery receipts
  // (sent/delivered/read/failed) arriving on the webhook long after the message was sent.
  // Distinct from message.created so subscribers replace a bubble instead of appending one.
  | { type: 'message.updated'; conversationId: string; message: unknown }
  | { type: 'handoff.alert'; conversationId: string; contactName: string | null }
  // Satu balasan bot yang tidak bersandar pada fakta mana pun baru saja tercatat
  // (src/lib/inbox/gap-log.ts). Sengaja tidak membawa isi apa pun selain percakapannya:
  // lencana lonceng hanya perlu tahu ada yang baru, dan daftarnya diambil ulang dari
  // /api/inbox/gaps oleh penerima yang memang menampilkannya.
  | { type: 'knowledge.gap'; conversationId: string }
  // The pinned sandbox conversation's history + TripBrief were wiped (see
  // api/conversations/[id]/clear) -- subscribers drop every locally-held message for this
  // conversation rather than waiting for a full page reload.
  | { type: 'conversation.cleared'; conversationId: string }
  // Kolom pada baris Conversation berubah di server tanpa ada pesan baru -- hari ini hanya
  // `pipelineStage` dan `orderChannel`, yang dinaikkan sendiri oleh data booking (lihat
  // ensureFreshBookingData). Sengaja TIDAK membawa nilai barunya: daftar percakapan butuh
  // beberapa field lain untuk merender satu baris (nama kontak, label, botEnabled), jadi
  // penerimanya mengambil ulang daftarnya -- persis seperti yang sudah dilakukan saat ada
  // pesan dari percakapan yang belum dikenal.
  | { type: 'conversation.updated'; conversationId: string }
  // One step boundary of one bot run, emitted live while the run is still in flight (see
  // src/lib/pipeline/tracer.ts). `stepId` is a PipelineStepId from src/lib/pipeline/steps.ts,
  // never a free-form string. `runId` is the id the run's BotDecisionRun row will be written
  // under, so the live canvas and the stored history refer to the same run.
  //
  // Unlike every event above it, nothing about the inbox depends on this one: ConversationList,
  // ThreadView and NotificationListener each gate on their own `event.type` and drop anything
  // else, which is what makes adding a member here safe (realtime.test.ts pins that).
  | {
      type: 'pipeline.step'
      runId: string
      conversationId: string
      stepId: string
      status: 'mulai' | 'selesai' | 'dilewati' | 'berhenti' | 'gagal'
      at: string
      // Already through sanitizeTrace at the tracer, never raw -- this crosses the wire to
      // every open browser tab, and a token in it would be a token on screen.
      detail?: unknown
    }

const listeners = new Set<(event: RealtimeEvent) => void>()

// Tiap listener diisolasi. Satu subscriber SSE yang controller-nya sudah ditutup akan
// melempar saat di-enqueue, dan tanpa try/catch di sini lemparan itu menghentikan loop —
// sehingga subscriber yang terdaftar SETELAHNYA tidak pernah menerima event itu sama sekali.
// Gejalanya: satu tab yang ditutup diam-diam membuat tab lain berhenti hidup.
//
// Dibiarkan sampai sekarang karena lalu lintasnya jarang (pesan masuk saja). Instrumentasi
// pipeline menaikkannya jadi 6-12 event per giliran bot, yang membuat peluang menabrak
// controller mati ikut naik sebanding.
export function broadcast(event: RealtimeEvent): void {
  for (const listener of listeners) {
    try {
      listener(event)
    } catch (error) {
      console.error('realtime: listener melempar, dilewati', { type: event.type, error })
    }
  }
}

export function subscribe(listener: (event: RealtimeEvent) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
