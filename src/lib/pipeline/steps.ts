/**
 * Peta KASAR dari perjalanan satu pesan: dari webhook Meta sampai balasan (atau handoff)
 * benar-benar terkirim ke pelanggan.
 *
 * Bedanya dengan `src/lib/bot-control/existing-flow-registry.ts`: registry itu punya 28 node,
 * satu node per fungsi nyata — bagus untuk membaca detail, terlalu rapat untuk sebuah kanvas.
 * File ini mengelompokkan 28 node yang sama menjadi 11 langkah yang bisa dimengerti operator
 * ("Cek booking pelanggan", bukan "ensureFreshBookingData"), dan menyimpan node-node aslinya
 * sebagai `subSteps` untuk drill-down. Setiap node dari registry lama muncul TEPAT SEKALI di
 * sini; `steps.test.ts` menegakkan itu, jadi node baru di sana tidak bisa diam-diam hilang dari
 * kanvas.
 *
 * Kenapa data statis, bukan turunan runtime: sama persis dengan alasan registry lama — pipeline
 * ini adalah control flow (early return, Promise.all yang sengaja tidak simetris, funnel yang
 * bertanya ulang), bukan struktur data yang bisa di-introspeksi. Yang bisa dilakukan adalah
 * menulis petanya dengan tangan dan MENGIKATNYA ke kode lewat test: setiap `sourceRef` menunjuk
 * file yang harus benar-benar ada dan simbol yang harus benar-benar muncul di file itu, sehingga
 * rename atau penghapusan menggagalkan suite alih-alih membuat kanvas jadi fiksi.
 *
 * Koordinat (`x`, `y`) ikut di sini karena kanvasnya di-layout tangan dan jumlah node-nya tetap.
 * Layout adalah data, bukan hasil hitungan; menaruhnya di sini berarti lapisan UI cukup
 * menggambar, tidak perlu menjalankan algoritma layout untuk 11 kotak yang tidak pernah berubah.
 *
 * Modul ini MURNI: tidak menyentuh database, jaringan, maupun `process.env`. Aman diimpor dari
 * server maupun komponen klien.
 *
 * BUKAN cakupan file ini: antrean outbound (OutboundJob, retry, safety guard). Peta ini berhenti
 * di titik pesan diserahkan ke jalur kirim.
 */

/** Id stabil. Sengaja deskriptif dan tidak mengandung nama fungsi, supaya kebal rename kode. */
export type PipelineStepId =
  | 'terima-pesan'
  | 'simpan-percakapan'
  | 'gerbang-bot'
  | 'kumpulkan-burst'
  | 'cek-eskalasi'
  | 'cek-booking'
  | 'pahami-kebutuhan'
  | 'susun-balasan'
  | 'verifikasi-balasan'
  | 'serahkan-agen'
  | 'kirim-balasan'

/**
 * Penunjuk ke kode nyata. `symbol` adalah nama fungsi/konstanta yang harus muncul di `file`;
 * `steps.test.ts` mengecek keduanya, jadi peta ini tidak bisa basi tanpa ketahuan.
 */
export type PipelineSourceRef = { file: string; symbol: string }

/** Satu node dari `existing-flow-registry.ts`, dipakai untuk drill-down saat step diklik. */
export type PipelineSubStep = {
  /** Sama persis dengan `ExistingFlowNode.id` di existing-flow-registry.ts. */
  id: string
  label: string
  sourceRef: PipelineSourceRef
}

/** Kemungkinan step berikutnya. Lebih dari satu berarti percabangan. */
export type PipelineTransition = {
  to: PipelineStepId
  /** Kondisi yang membuat cabang ini diambil. Wajib bila step punya lebih dari satu `next`. */
  condition?: string
}

export type PipelineStep = {
  id: PipelineStepId
  /** Bahasa operator, bukan nama fungsi. */
  label: string
  summary: string
  sourceRef: PipelineSourceRef
  /** Koordinat kanvas hasil layout tangan. Satuan piksel, origin kiri-atas. */
  x: number
  y: number
  subSteps: PipelineSubStep[]
  next: PipelineTransition[]
}

/** Step tempat setiap run selalu dimulai. Dipakai test keterjangkauan dan oleh kanvas. */
export const PIPELINE_ENTRY_STEP_ID: PipelineStepId = 'terima-pesan'

/** Jarak antar kolom/baris layout tangan di bawah. Dikumpulkan supaya mudah digeser serentak. */
const COL = 200
const LANE_MAIN = 60
const LANE_HANDOFF = 260

export const PIPELINE_STEPS: PipelineStep[] = [
  {
    id: 'terima-pesan',
    label: 'Pesan masuk diterima',
    summary:
      'Meta mengirim webhook, signature-nya diverifikasi dengan raw body, lalu satu payload dipecah menjadi unit-unit (pesan, echo agent, status). Pesan dengan externalId yang sudah ada dilewati supaya retry Meta tidak menggandakan bubble.',
    sourceRef: { file: 'src/app/api/webhooks/meta/route.ts', symbol: 'POST' },
    x: 40,
    y: LANE_MAIN,
    subSteps: [
      {
        id: 'meta-webhook-received',
        label: 'Webhook Meta diterima',
        sourceRef: { file: 'src/app/api/webhooks/meta/route.ts', symbol: 'POST' },
      },
      {
        id: 'signature-verified',
        label: 'Signature diverifikasi',
        sourceRef: { file: 'src/lib/meta/webhook-verify.ts', symbol: 'verifyMetaSignature' },
      },
      {
        id: 'payload-normalized',
        label: 'Payload dinormalisasi',
        sourceRef: { file: 'src/lib/inbound.ts', symbol: 'ingestMetaMessage' },
      },
    ],
    next: [{ to: 'simpan-percakapan' }],
  },
  {
    id: 'simpan-percakapan',
    label: 'Kontak & percakapan disimpan',
    summary:
      'Kontak di-upsert dari nomor telepon, percakapan dibuat bila belum ada, baris Message ditulis, lalu disiarkan ke inbox lewat SSE. Sampai titik ini bot belum dilibatkan sama sekali — pesan sudah aman di inbox meski bot mati.',
    sourceRef: { file: 'src/lib/inbound.ts', symbol: 'ingestSingleMessage' },
    x: 40 + COL,
    y: LANE_MAIN,
    subSteps: [
      {
        id: 'conversation-upserted',
        label: 'Kontak & percakapan di-upsert',
        sourceRef: { file: 'src/lib/inbound.ts', symbol: 'ingestSingleMessage' },
      },
    ],
    next: [{ to: 'gerbang-bot' }],
  },
  {
    id: 'gerbang-bot',
    label: 'Kelayakan bot dicek',
    summary:
      'Percakapan baru mengikuti Settings.botAutoReplyAll, dan nomor +62 dilewati bila filter nomor Indonesia menyala. Percakapan lama mempertahankan botEnabled-nya sendiri: agent yang mengambil alih tidak boleh dikembalikan ke bot oleh pesan berikutnya.',
    sourceRef: { file: 'src/lib/inbound.ts', symbol: 'defaultBotEnabled' },
    x: 40 + COL * 2,
    y: LANE_MAIN,
    subSteps: [
      {
        id: 'default-bot-policy-checked',
        label: 'Kebijakan bot default dicek',
        sourceRef: { file: 'src/lib/inbound.ts', symbol: 'defaultBotEnabled' },
      },
    ],
    // Cabang "bot nonaktif" berhenti di sini tanpa step berikutnya: pesan hanya masuk inbox dan
    // menunggu manusia. Itu akhir yang sah, bukan node tersendiri.
    next: [{ to: 'kumpulkan-burst', condition: 'bot aktif untuk percakapan ini' }],
  },
  {
    id: 'kumpulkan-burst',
    label: 'Pesan beruntun digabung',
    summary:
      'Fragment ditahan sampai jeda tenang habis (dibatasi budget max-wait), lalu digabung satu baris per fragment. Saat flush, botEnabled dibaca ULANG dari database dan rate limit percakapan dicek di sini — supaya giliran yang diblok tidak memakan biaya LLM sama sekali.',
    sourceRef: { file: 'src/lib/inbound.ts', symbol: 'scheduleBotRun' },
    x: 40 + COL * 3,
    y: LANE_MAIN,
    subSteps: [
      {
        id: 'burst-debounce',
        label: 'Debounce pesan beruntun',
        sourceRef: { file: 'src/lib/inbound.ts', symbol: 'scheduleBotRun' },
      },
      {
        id: 'fresh-bot-enabled-check',
        label: 'Cek ulang botEnabled',
        sourceRef: { file: 'src/lib/inbound.ts', symbol: 'flushBurst' },
      },
      {
        id: 'rate-limit-check',
        label: 'Rate limit percakapan',
        sourceRef: { file: 'src/lib/bot/rate-limiter.ts', symbol: 'checkAndRecordRateLimit' },
      },
    ],
    next: [{ to: 'cek-eskalasi', condition: 'masih bot-driven dan di bawah rate limit' }],
  },
  {
    id: 'cek-eskalasi',
    label: 'Cek permintaan bicara ke manusia',
    summary:
      'Gerbang kata kunci berjalan lebih dulu dan selalu menang; lapisan LLM menangkap komplain/frustrasi yang tidak memakai kata kunci apa pun. Verdict eskalasi diputuskan sebelum hasil pencarian booking, supaya pelanggan yang marah tidak berakhir menerima pesan "kendala teknis".',
    sourceRef: { file: 'src/lib/bot/orchestrator.ts', symbol: 'decideAndRespond' },
    x: 40 + COL * 4,
    y: LANE_MAIN,
    subSteps: [
      {
        id: 'decide-and-respond',
        label: 'Decision engine dijalankan',
        sourceRef: { file: 'src/lib/bot/orchestrator.ts', symbol: 'decideAndRespond' },
      },
      {
        id: 'escalation-keyword-check',
        label: 'Cek kata kunci eskalasi',
        sourceRef: { file: 'src/lib/bot/orchestrator.ts', symbol: 'isEscalation' },
      },
      {
        id: 'escalation-llm-check',
        label: 'Cek sinyal eskalasi via LLM',
        sourceRef: {
          file: 'src/lib/bot/escalation-classifier.ts',
          symbol: 'detectsAdditionalEscalationSignal',
        },
      },
    ],
    next: [
      { to: 'serahkan-agen', condition: 'kata kunci atau sinyal LLM terdeteksi' },
      { to: 'cek-booking', condition: 'tidak ada sinyal eskalasi' },
    ],
  },
  {
    id: 'cek-booking',
    label: 'Cek booking pelanggan',
    summary:
      'Nomor pelanggan dicari di sistem booking. Bila ada pesanan aktif, jawaban disusun dari data booking itu sendiri (tanggal, jam jemput, hotel) dan katalog umum dilewati sepenuhnya — angka milik pelanggan ini selalu mengalahkan angka generik paket.',
    sourceRef: { file: 'src/lib/booking/client.ts', symbol: 'lookupBooking' },
    x: 40 + COL * 5,
    y: LANE_MAIN,
    subSteps: [
      {
        id: 'booking-lookup',
        label: 'Pencarian booking',
        sourceRef: { file: 'src/lib/booking/client.ts', symbol: 'lookupBooking' },
      },
      {
        id: 'booking-context-reply',
        label: 'Jawaban berbasis booking',
        sourceRef: { file: 'src/lib/bot/orchestrator.ts', symbol: 'runBookingContextMode' },
      },
    ],
    next: [
      { to: 'verifikasi-balasan', condition: 'booking ditemukan — jawaban dari data booking' },
      { to: 'pahami-kebutuhan', condition: 'tidak ada booking aktif' },
    ],
  },
  {
    id: 'pahami-kebutuhan',
    label: 'Pahami kebutuhan & cocokkan paket',
    summary:
      'Gerbang persetujuan katalog, klasifikasi kebutuhan penjualan (J1–J5), pencocokan destinasi, gerbang integritas rute, penyempitan kandidat paket, klasifikasi topik, dan funnel preferensi (asal, kota akhir, jumlah hari). Bila ada yang kurang, bot bertanya balik alih-alih menebak.',
    sourceRef: {
      file: 'src/lib/bot/orchestrator.ts',
      symbol: 'computeTripPreferencesFunnelDecision',
    },
    x: 40 + COL * 6,
    y: LANE_MAIN,
    subSteps: [
      {
        id: 'deployment-gate',
        label: 'Gerbang persetujuan deployment',
        sourceRef: { file: 'src/lib/bot/deployment-gate.ts', symbol: 'checkDeploymentGate' },
      },
      {
        id: 'sales-need-classification',
        label: 'Klasifikasi kebutuhan penjualan',
        sourceRef: { file: 'src/lib/bot/sales-classifier.ts', symbol: 'classifySalesNeed' },
      },
      {
        id: 'destination-match',
        label: 'Pencocokan destinasi',
        sourceRef: { file: 'src/lib/bot/package-match.ts', symbol: 'parseTripPreferences' },
      },
      {
        id: 'route-integrity-gate',
        label: 'Gerbang integritas rute',
        sourceRef: { file: 'src/lib/bot/route-gate.ts', symbol: 'checkRouteGate' },
      },
      {
        id: 'package-pool-narrowing',
        label: 'Penyempitan kandidat paket',
        sourceRef: { file: 'src/lib/bot/package-match.ts', symbol: 'pickPackage' },
      },
      {
        id: 'topic-classification',
        label: 'Klasifikasi topik',
        sourceRef: { file: 'src/lib/bot/topic-classifier.ts', symbol: 'classifyTopicViaLLM' },
      },
      {
        id: 'trip-preference-check',
        label: 'Funnel preferensi perjalanan',
        sourceRef: {
          file: 'src/lib/bot/orchestrator.ts',
          symbol: 'computeTripPreferencesFunnelDecision',
        },
      },
    ],
    next: [
      { to: 'susun-balasan', condition: 'kebutuhan cukup jelas untuk dijawab' },
      {
        to: 'kirim-balasan',
        condition: 'clarify — bot balik bertanya, tanpa knowledge/LLM grounding',
      },
      {
        to: 'serahkan-agen',
        condition: 'gerbang tertutup, rute tidak dilayani, atau kebutuhan J5',
      },
    ],
  },
  {
    id: 'susun-balasan',
    label: 'Susun balasan dari knowledge',
    summary:
      'Fakta yang sah untuk topik ini dikumpulkan dari katalog, lalu LLM menyusun kalimatnya HANYA dari fakta itu plus riwayat terakhir. LLM berperan sebagai penulis, bukan sumber pengetahuan. Bila tidak ada fakta yang bisa dipakai, barisnya dicatat sebagai knowledge gap.',
    sourceRef: { file: 'src/lib/bot/knowledge.ts', symbol: 'resolveKnowledgeForTopic' },
    x: 40 + COL * 7,
    y: LANE_MAIN,
    subSteps: [
      {
        id: 'knowledge-resolution',
        label: 'Resolusi knowledge',
        sourceRef: { file: 'src/lib/bot/knowledge.ts', symbol: 'resolveKnowledgeForTopic' },
      },
      {
        id: 'llm-composition',
        label: 'Penyusunan balasan oleh LLM',
        sourceRef: { file: 'src/lib/bot/llm.ts', symbol: 'callLLM' },
      },
      {
        id: 'knowledge-gap-log',
        label: 'Pencatatan knowledge gap',
        sourceRef: { file: 'src/lib/bot/orchestrator.ts', symbol: 'recordKnowledgeGap' },
      },
    ],
    next: [
      { to: 'verifikasi-balasan', condition: 'draft balasan tersusun' },
      { to: 'serahkan-agen', condition: 'tidak ada fakta yang bisa dipakai' },
    ],
  },
  {
    id: 'verifikasi-balasan',
    label: 'Verifikasi harga & tautan',
    summary:
      'Setiap angka rupiah dan setiap URL di draft dicocokkan dengan grounding. Draft yang gagal dikirim ulang ke LLM dengan instruksi perbaikan; gagal dua kali berturut-turut berakhir handoff, bukan dikirim apa adanya.',
    sourceRef: { file: 'src/lib/bot/reply-verifier.ts', symbol: 'verifyReply' },
    x: 40 + COL * 8,
    y: LANE_MAIN,
    subSteps: [
      {
        id: 'reply-verification',
        label: 'Verifikasi balasan',
        sourceRef: { file: 'src/lib/bot/reply-verifier.ts', symbol: 'verifyReply' },
      },
    ],
    next: [
      { to: 'kirim-balasan', condition: 'lolos verifikasi' },
      { to: 'serahkan-agen', condition: 'gagal dua kali' },
    ],
  },
  {
    id: 'serahkan-agen',
    label: 'Diserahkan ke agen manusia',
    summary:
      'Satu pengakuan jujur yang generik dikirim ke pelanggan (plus catatan di luar jam kerja bila ada), botEnabled percakapan dimatikan, lalu handoff.alert disiarkan ke agent. Tanpa mematikan botEnabled percakapan tetap bot-driven dan setiap pesan berikutnya memicu notifikasi baru.',
    sourceRef: { file: 'src/lib/inbound.ts', symbol: 'runBotForConversation' },
    x: 40 + COL * 8,
    y: LANE_HANDOFF,
    subSteps: [
      {
        id: 'handoff-alert',
        label: 'Handoff & notifikasi agent',
        sourceRef: { file: 'src/lib/inbound.ts', symbol: 'runBotForConversation' },
      },
    ],
    next: [{ to: 'kirim-balasan', condition: 'pengakuan handoff dikirim ke pelanggan' }],
  },
  {
    id: 'kirim-balasan',
    label: 'Balasan dikirim ke pelanggan',
    summary:
      'Channel keluar ditentukan (default Unofficial lewat provider coexistence; Official hanya untuk kapabilitas yang memang official-only seperti template resmi), lalu pesan dikirim. Antrean outbound, retry, dan safety guard berada di luar peta ini.',
    sourceRef: { file: 'src/lib/send.ts', symbol: 'sendMessage' },
    x: 40 + COL * 9,
    y: LANE_MAIN,
    subSteps: [
      {
        id: 'outbound-policy-resolution',
        label: 'Penentuan jalur pengiriman',
        sourceRef: { file: 'src/lib/channel-router.ts', symbol: 'resolveChannel' },
      },
      {
        id: 'unofficial-send',
        label: 'Pengiriman via Unofficial',
        sourceRef: { file: 'src/lib/coexist/client.ts', symbol: 'sendCoexistText' },
      },
      {
        id: 'official-template-send',
        label: 'Pengiriman template Official',
        sourceRef: { file: 'src/lib/meta/messages.ts', symbol: 'sendTemplateMessage' },
      },
    ],
    next: [],
  },
]

export function getPipelineStep(id: string): PipelineStep | null {
  return PIPELINE_STEPS.find((step) => step.id === id) ?? null
}

/** Semua id step, urut sesuai urutan deklarasi (kiri ke kanan di kanvas). */
export function listPipelineStepIds(): PipelineStepId[] {
  return PIPELINE_STEPS.map((step) => step.id)
}

/**
 * Sisi-sisi graf dalam bentuk datar — dipakai kanvas untuk menggambar konektor, dan oleh test
 * integritas. Diturunkan dari `next`, jadi tidak mungkin melenceng dari daftar step.
 */
export type PipelineEdge = { from: PipelineStepId; to: PipelineStepId; condition?: string }

export function listPipelineEdges(): PipelineEdge[] {
  return PIPELINE_STEPS.flatMap((step) =>
    step.next.map((transition) => ({
      from: step.id,
      to: transition.to,
      condition: transition.condition,
    }))
  )
}

/** Step yang mengakhiri run (tidak punya `next`) — yaitu akhir jalur kirim. */
export function listTerminalPipelineStepIds(): PipelineStepId[] {
  return PIPELINE_STEPS.filter((step) => step.next.length === 0).map((step) => step.id)
}

/** Peta subStep id → step kasar yang memuatnya. Dipakai untuk memetakan trace/log ke kanvas. */
export function findStepBySubStepId(subStepId: string): PipelineStep | null {
  return PIPELINE_STEPS.find((step) => step.subSteps.some((sub) => sub.id === subStepId)) ?? null
}
