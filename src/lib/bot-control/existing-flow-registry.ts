/**
 * A read-only, executable map of the bot pipeline that ALREADY runs in production.
 *
 * Nothing here decides anything. Every node below documents a step that exists today in
 * `src/lib/inbound.ts`, `src/lib/bot/orchestrator.ts` and their collaborators; this file only
 * gives the Bot Control UI something to render so an operator can answer "what does the bot
 * actually do?" without reading 1,753 lines of orchestrator.
 *
 * Why a hand-written registry rather than something derived from the code: the pipeline is not
 * a data structure at runtime. It is control flow — early returns, a `Promise.allSettled` whose
 * two branches are deliberately NOT symmetric, a funnel that re-asks until three fields are
 * known. There is no object to introspect. Deriving a map would mean either building a parser
 * for the orchestrator or restructuring the orchestrator itself, and Phase 1's whole contract
 * (guidebook §23) is that bot behaviour does not change while we make it visible.
 *
 * The cost of that choice is drift: this file can fall behind the code it describes. CLAUDE.md
 * §2 makes keeping them in step part of any bot change, and `existing-flow-registry.test.ts`
 * asserts every `sourceFile` is a path that really exists, so a renamed or deleted module fails
 * the suite instead of quietly turning the Flow Map into fiction.
 */

export type ExistingFlowNodeType =
  | 'webhook'
  | 'guard'
  | 'classifier'
  | 'lookup'
  | 'knowledge'
  | 'llm'
  | 'verification'
  | 'send'
  | 'handoff'

export type ExistingFlowNode = {
  id: string
  order: number
  name: string
  type: ExistingFlowNodeType
  description: string
  sourceFile: string
  sourceRef?: string
  possibleOutputs: string[]
  /** Keys from `rule-registry.ts` that this step enforces. Empty when no registered rule lands here. */
  relatedRuleKeys?: string[]
}

export type ExistingFlowEdge = { from: string; to: string; condition?: string }

export type ExistingFlowDefinition = {
  key: string
  name: string
  version: number
  description: string
  nodes: ExistingFlowNode[]
  edges: ExistingFlowEdge[]
}

export const EXISTING_BOT_FLOW_KEY = 'whatsapp-existing-bot-v1'

const NODES: ExistingFlowNode[] = [
  {
    id: 'meta-webhook-received',
    order: 1,
    name: 'Webhook Meta diterima',
    type: 'webhook',
    description:
      'Meta mengirim POST ke endpoint webhook untuk setiap pesan masuk, status pengiriman, dan update status template. Ini satu-satunya pintu masuk pesan customer — jalur Unofficial tidak menerima webhook sama sekali.',
    sourceFile: 'src/app/api/webhooks/meta/route.ts',
    sourceRef: 'POST',
    possibleOutputs: ['payload diteruskan ke verifikasi signature'],
    relatedRuleKeys: ['channel.official_inbound_only'],
  },
  {
    id: 'signature-verified',
    order: 2,
    name: 'Signature diverifikasi',
    type: 'guard',
    description:
      'Header x-hub-signature-256 dicocokkan dengan HMAC dari raw body memakai META_APP_SECRET. Body mentah dipakai apa adanya — mem-parse lalu men-stringify ulang JSON akan mengubah byte-nya dan membuat setiap signature yang sah gagal.',
    sourceFile: 'src/lib/meta/webhook-verify.ts',
    sourceRef: 'verifyMetaSignature',
    possibleOutputs: ['valid → lanjut normalisasi', 'tidak valid → 401, payload dibuang'],
    relatedRuleKeys: ['channel.official_inbound_only'],
  },
  {
    id: 'payload-normalized',
    order: 3,
    name: 'Payload dinormalisasi',
    type: 'webhook',
    description:
      'Satu payload Meta bisa membawa banyak entry dan banyak change sekaligus (pesan, echo pesan agent, status, status template). Semuanya dipecah menjadi unit-unit yang dapat diproses, dan pesan yang externalId-nya sudah ada di database dilewati agar retry Meta tidak menggandakan bubble.',
    sourceFile: 'src/lib/inbound.ts',
    sourceRef: 'ingestMetaMessage',
    possibleOutputs: ['pesan customer', 'echo pesan agent', 'status pengiriman', 'status template', 'duplikat → diabaikan'],
  },
  {
    id: 'conversation-upserted',
    order: 4,
    name: 'Kontak & percakapan disimpan',
    type: 'lookup',
    description:
      'Kontak di-upsert berdasarkan nomor telepon (nama profil diambil dari contacts array milik change itu sendiri, bukan satu nilai global — kalau tidak, nama satu pengirim menempel ke kontak pengirim lain saat beberapa change dibatch), percakapan dibuat bila belum ada, lalu baris Message ditulis dan disiarkan ke inbox lewat SSE.',
    sourceFile: 'src/lib/inbound.ts',
    sourceRef: 'ingestSingleMessage',
    possibleOutputs: ['percakapan baru dibuat', 'percakapan existing dipakai ulang'],
  },
  {
    id: 'default-bot-policy-checked',
    order: 5,
    name: 'Kebijakan bot default dicek',
    type: 'guard',
    description:
      'Menentukan apakah percakapan baru dimulai dengan botEnabled true: mengikuti Settings.botAutoReplyAll, dan bila filter nomor Indonesia aktif, nomor +62 tidak dibalas otomatis. Percakapan yang sudah ada mempertahankan nilainya sendiri — agent yang mengambil alih tidak boleh dikembalikan ke bot oleh pesan berikutnya.',
    sourceFile: 'src/lib/inbound.ts',
    sourceRef: 'defaultBotEnabled',
    possibleOutputs: ['bot aktif → lanjut', 'bot nonaktif → berhenti, pesan hanya masuk inbox'],
    relatedRuleKeys: ['bot.skip_indonesian_numbers'],
  },
  {
    id: 'burst-debounce',
    order: 6,
    name: 'Debounce pesan beruntun',
    type: 'guard',
    description:
      'Customer sering mengirim satu pikiran dalam tiga pesan pendek. Fragment ditahan sampai jeda tenang habis (dibatasi budget max-wait supaya pengirim yang terus mengetik tidak menunda balasan tanpa batas), lalu digabung satu baris per fragment menjadi satu input untuk decision engine.',
    sourceFile: 'src/lib/inbound.ts',
    sourceRef: 'scheduleBotRun',
    possibleOutputs: ['burst digabung jadi satu input', 'pesan susulan bergabung ke burst berjalan'],
    relatedRuleKeys: ['bot.burst_debounce'],
  },
  {
    id: 'fresh-bot-enabled-check',
    order: 7,
    name: 'Cek ulang botEnabled',
    type: 'guard',
    description:
      'botEnabled dibaca ULANG dari database saat burst di-flush, bukan dipercaya dari saat pesan pertama tiba. Agent bisa menekan "Ambil Alih dari Bot" kapan saja selama jeda debounce, dan nilai basi akan tetap mengirim balasan bot tepat setelah manusia mengambil alih.',
    sourceFile: 'src/lib/inbound.ts',
    sourceRef: 'flushBurst',
    possibleOutputs: ['masih bot-driven → lanjut', 'sudah diambil alih → berhenti tanpa membalas'],
  },
  {
    id: 'rate-limit-check',
    order: 8,
    name: 'Rate limit percakapan',
    type: 'guard',
    description:
      'Membatasi jumlah auto-reply per percakapan dalam satu window. Dicek di sini, bukan di dalam decideAndRespond, supaya giliran yang diblok tidak memakan biaya sama sekali — bahkan classifier eskalasi pun tidak jalan. Percakapan sandbox (isTest) dikecualikan: admin yang sengaja menguji bot justru tidak boleh di-throttle.',
    sourceFile: 'src/lib/bot/rate-limiter.ts',
    sourceRef: 'checkAndRecordRateLimit',
    possibleOutputs: ['di bawah limit → lanjut', 'melebihi limit → dilewati (SKIPPED)', 'percakapan test → selalu lanjut'],
    relatedRuleKeys: ['bot.rate_limit'],
  },
  {
    id: 'decide-and-respond',
    order: 9,
    name: 'Decision engine dijalankan',
    type: 'classifier',
    description:
      'Pintu masuk seluruh penalaran bot. Mengembalikan tepat satu dari empat mode — handoff, faq, booking_context, clarify — beserta jejak langkah (TraceStep[]) yang menjadi isi Message.botTrace.',
    sourceFile: 'src/lib/bot/orchestrator.ts',
    sourceRef: 'decideAndRespond',
    possibleOutputs: ['handoff', 'faq', 'booking_context', 'clarify'],
  },
  {
    id: 'escalation-keyword-check',
    order: 10,
    name: 'Cek kata kunci eskalasi',
    type: 'guard',
    description:
      'Regex sempit untuk permintaan eksplisit bicara dengan manusia. Sengaja dijalankan paling awal: permintaan bertemu manusia tidak boleh kalah oleh jawaban katalog yang kebetulan cocok.',
    sourceFile: 'src/lib/bot/orchestrator.ts',
    sourceRef: 'isEscalation',
    possibleOutputs: ['cocok → handoff', 'tidak cocok → lanjut cek LLM'],
    relatedRuleKeys: ['bot.handoff_on_human_request'],
  },
  {
    id: 'escalation-llm-check',
    order: 11,
    name: 'Cek sinyal eskalasi via LLM',
    type: 'llm',
    description:
      'Lapisan aditif untuk komplain dan frustrasi yang tidak memakai kata kunci apa pun. Berjalan bersamaan dengan pencarian booking, tetapi verdict-nya diputuskan lebih dulu dan kebal terhadap kegagalan booking — kalau tidak, customer yang marah akan menerima "ada kendala teknis kecil" dan tidak ada manusia yang pernah diberi tahu.',
    sourceFile: 'src/lib/bot/escalation-classifier.ts',
    sourceRef: 'detectsAdditionalEscalationSignal',
    possibleOutputs: ['sinyal terdeteksi → handoff', 'tidak ada sinyal → lanjut', 'LLM gagal → dianggap tidak ada sinyal'],
    relatedRuleKeys: ['bot.handoff_on_human_request'],
  },
  {
    id: 'booking-lookup',
    order: 12,
    name: 'Pencarian booking',
    type: 'lookup',
    description:
      'Nomor customer dicari di sistem booking untuk menemukan pesanan aktif beserta tanggal, itinerary, titik jemput, dan hotel. Ini yang mengubah bot dari penjawab katalog umum menjadi penjawab yang tahu perjalanan orang ini.',
    sourceFile: 'src/lib/booking/client.ts',
    sourceRef: 'lookupBooking',
    possibleOutputs: ['booking ditemukan', 'tidak ada booking', 'pencarian gagal → lanjut tanpa konteks booking'],
    relatedRuleKeys: ['bot.booking_context_first'],
  },
  {
    id: 'booking-context-reply',
    order: 13,
    name: 'Jawaban berbasis booking',
    type: 'knowledge',
    description:
      'Saat booking ditemukan, jawaban disusun dari data booking itu sendiri sebelum katalog umum dipakai. Tanggal, jam jemput, dan hotel milik customer selalu mengalahkan angka generik dari paket.',
    sourceFile: 'src/lib/bot/orchestrator.ts',
    sourceRef: 'runBookingContextMode',
    possibleOutputs: ['booking_context (terjawab)', 'clarify (data booking tidak menjawab pertanyaan)'],
    relatedRuleKeys: ['bot.booking_context_first', 'bot.no_invented_price'],
  },
  {
    id: 'deployment-gate',
    order: 14,
    name: 'Gerbang persetujuan deployment',
    type: 'guard',
    description:
      'Saklar operasional: selama katalog/knowledge yang baru disinkronkan belum disetujui, bot tidak menjawab pertanyaan penjualan dan menyerahkannya ke manusia. Gerbang ini disimpan di file khusus VPS yang tidak ikut repo, sehingga rsync deploy bisa menghapusnya diam-diam bila tidak dikecualikan.',
    sourceFile: 'src/lib/bot/deployment-gate.ts',
    sourceRef: 'checkDeploymentGate',
    possibleOutputs: ['terbuka → lanjut ke klasifikasi penjualan', 'tertutup → handoff'],
  },
  {
    id: 'sales-need-classification',
    order: 15,
    name: 'Klasifikasi kebutuhan penjualan',
    type: 'classifier',
    description:
      'Menetapkan job penjualan (J1–J5), informasi apa yang masih kurang, dan apakah pertanyaan ini butuh data live. Hasilnya menentukan seberapa jauh pipeline katalog perlu dijalankan.',
    sourceFile: 'src/lib/bot/sales-classifier.ts',
    sourceRef: 'classifySalesNeed',
    possibleOutputs: ['J1..J5 + daftar informasi yang kurang', 'kebutuhan penanganan manusia → handoff'],
  },
  {
    id: 'destination-match',
    order: 16,
    name: 'Pencocokan destinasi',
    type: 'lookup',
    description:
      'Menarik token destinasi dari pesan dan dari TripBrief yang sudah tersimpan. Pencocokan bersifat token-wise: tidak ada paket berdestinasi tunggal di rilis nyata, semuanya tur overland yang melewati 2–6 destinasi, jadi paket cocok bila SALAH SATU token-nya cocok.',
    sourceFile: 'src/lib/bot/package-match.ts',
    sourceRef: 'parseTripPreferences',
    possibleOutputs: ['destinasi teridentifikasi', 'tidak ada destinasi → cabang tanpa destinasi'],
  },
  {
    id: 'route-integrity-gate',
    order: 17,
    name: 'Gerbang integritas rute',
    type: 'guard',
    description:
      'Memeriksa apakah destinasi yang diminta benar-benar dilayani oleh katalog. Rute yang tidak dikenali tidak boleh dijawab dengan tebakan — hasilnya clear, needs_review, atau handoff.',
    sourceFile: 'src/lib/bot/route-gate.ts',
    sourceRef: 'checkRouteGate',
    possibleOutputs: ['clear → lanjut', 'needs_review → clarify', 'handoff'],
    relatedRuleKeys: ['bot.no_invented_price'],
  },
  {
    id: 'package-pool-narrowing',
    order: 18,
    name: 'Penyempitan kandidat paket',
    type: 'lookup',
    description:
      'Menyaring paket berdasarkan kota asal, jumlah hari, kota akhir, dan destinasi yang disebut. Kota akhir BUKAN kebalikan dari kota asal: paket berasal Bali justru berakhir di area Surabaya/Malang, jadi "bisa selesai di Bali?" harus dijawab dari finishCities, bukan dari origin.',
    sourceFile: 'src/lib/bot/package-match.ts',
    sourceRef: 'pickPackage',
    possibleOutputs: ['satu paket cocok', 'beberapa paket cocok → semua ditawarkan', 'tidak ada yang cocok → fallback bertingkat'],
  },
  {
    id: 'topic-classification',
    order: 19,
    name: 'Klasifikasi topik',
    type: 'classifier',
    description:
      'Menetapkan topik pertanyaan (14 topik resolver: harga, rooming, kendaraan, titik jemput, kebijakan, dan seterusnya). LLM dipakai lebih dulu; bila gagal atau hasilnya tidak valid, klasifikasi keyword yang lama tetap menjawab.',
    sourceFile: 'src/lib/bot/topic-classifier.ts',
    sourceRef: 'classifyTopicViaLLM',
    possibleOutputs: ['topik resolver terpilih', 'LLM gagal → fallback klasifikasi keyword'],
  },
  {
    id: 'trip-preference-check',
    order: 20,
    name: 'Funnel preferensi perjalanan',
    type: 'guard',
    description:
      'Kota asal, kota akhir, dan jumlah hari wajib diketahui sebelum rekomendasi paket keluar. Bila kurang, bot bertanya alih-alih menebak; satu-satunya jalan pintas adalah customer yang secara eksplisit menyatakan tidak tahu atau tidak keberatan.',
    sourceFile: 'src/lib/bot/orchestrator.ts',
    sourceRef: 'computeTripPreferencesFunnelDecision',
    possibleOutputs: ['lengkap → lanjut ke knowledge', 'kurang → clarify (bertanya)', 'customer menolak menjawab → lanjut apa adanya'],
  },
  {
    id: 'knowledge-resolution',
    order: 21,
    name: 'Resolusi knowledge',
    type: 'knowledge',
    description:
      'Mengumpulkan fakta yang benar-benar boleh dipakai untuk topik ini dari catalog/*.json — termasuk modul yang terpicu keyword dan fakta per-leg rute. Himpunan inilah yang menjadi grounding: harga dan URL di luar himpunan ini tidak sah.',
    sourceFile: 'src/lib/bot/knowledge.ts',
    sourceRef: 'resolveKnowledgeForTopic',
    possibleOutputs: ['fakta ditemukan → lanjut komposisi', 'tidak ada fakta → knowledge gap dicatat'],
    relatedRuleKeys: ['bot.no_invented_price', 'bot.no_invented_url'],
  },
  {
    id: 'llm-composition',
    order: 22,
    name: 'Penyusunan balasan oleh LLM',
    type: 'llm',
    description:
      'Ollama menyusun balasan HANYA dari fakta yang sudah di-resolve plus riwayat percakapan terakhir. LLM di sini berperan sebagai penulis, bukan sumber pengetahuan.',
    sourceFile: 'src/lib/bot/llm.ts',
    sourceRef: 'callLLM',
    possibleOutputs: ['draft balasan', 'LLM gagal/timeout → clarify dengan pesan kendala teknis'],
  },
  {
    id: 'reply-verification',
    order: 23,
    name: 'Verifikasi balasan',
    type: 'verification',
    description:
      'Setiap angka rupiah dan setiap URL di draft dicocokkan dengan grounding. Draft yang gagal dikirim ulang ke LLM dengan instruksi perbaikan; gagal dua kali berturut-turut berakhir handoff, bukan dikirim apa adanya.',
    sourceFile: 'src/lib/bot/reply-verifier.ts',
    sourceRef: 'verifyReply',
    possibleOutputs: ['lolos → siap dikirim', 'gagal sekali → coba ulang dengan instruksi', 'gagal dua kali → handoff + knowledge gap'],
    relatedRuleKeys: ['bot.no_invented_price', 'bot.no_invented_url'],
  },
  {
    id: 'outbound-policy-resolution',
    order: 24,
    name: 'Penentuan jalur pengiriman',
    type: 'send',
    description:
      'Menentukan channel keluar. Default adalah Unofficial; Official dipilih hanya bila pemanggil meminta secara eksplisit untuk kapabilitas yang memang official-only.',
    sourceFile: 'src/lib/channel-router.ts',
    sourceRef: 'resolveChannel',
    possibleOutputs: ['UNOFFICIAL (default)', 'OFFICIAL (kapabilitas khusus)'],
    relatedRuleKeys: ['channel.unofficial_outbound_default', 'channel.official_reserved_for_capabilities'],
  },
  {
    id: 'unofficial-send',
    order: 25,
    name: 'Pengiriman via Unofficial',
    type: 'send',
    description:
      'Jalur kirim utama untuk balasan bot dan agent, lewat provider coexistence. Fase ini masih fire-and-forget — antrean, retry, dan safety guard adalah pekerjaan Phase 6.',
    sourceFile: 'src/lib/coexist/client.ts',
    possibleOutputs: ['terkirim', 'gagal → status pengiriman gagal di inbox'],
    relatedRuleKeys: ['channel.unofficial_outbound_default'],
  },
  {
    id: 'official-template-send',
    order: 26,
    name: 'Pengiriman template Official',
    type: 'send',
    description:
      'Jalur Official untuk yang memang tidak bisa lewat Unofficial: message template resmi, campaign legal, utility/auth, interactive official. Bukan jalur balasan harian.',
    sourceFile: 'src/lib/meta/messages.ts',
    possibleOutputs: ['template terkirim', 'ditolak Meta', 'status pengiriman lewat webhook'],
    relatedRuleKeys: ['channel.official_reserved_for_capabilities'],
  },
  {
    id: 'handoff-alert',
    order: 27,
    name: 'Handoff & notifikasi agent',
    type: 'handoff',
    description:
      'Setiap handoff mengirim satu pengakuan jujur yang generik ke customer, MEMATIKAN botEnabled untuk percakapan itu, lalu menyiarkan handoff.alert ke agent. Tanpa mematikan botEnabled percakapan tetap bot-driven, tidak pernah muncul di widget "perlu perhatian", dan setiap pesan berikutnya memicu notifikasi baru.',
    sourceFile: 'src/lib/inbound.ts',
    sourceRef: 'runBotForConversation',
    possibleOutputs: ['botEnabled → false', 'handoff.alert disiarkan', 'alasan tersimpan di botTrace'],
    relatedRuleKeys: ['bot.handoff_on_human_request'],
  },
  {
    id: 'knowledge-gap-log',
    order: 28,
    name: 'Pencatatan knowledge gap',
    type: 'knowledge',
    description:
      'Saat tidak ada fakta yang bisa di-resolve, atau verifikasi gagal dua kali, barisnya dicatat ke KnowledgeGapLog beserta topik dan alasannya. Ini yang mengubah "bot tidak bisa menjawab" dari keluhan menjadi daftar tugas perbaikan knowledge.',
    sourceFile: 'src/lib/bot/orchestrator.ts',
    sourceRef: 'recordKnowledgeGap',
    possibleOutputs: ['no_facts_resolved dicatat', 'verification_failed dicatat'],
  },
]

const EDGES: ExistingFlowEdge[] = [
  { from: 'meta-webhook-received', to: 'signature-verified' },
  { from: 'signature-verified', to: 'payload-normalized', condition: 'signature valid' },
  { from: 'payload-normalized', to: 'conversation-upserted', condition: 'pesan customer baru' },
  { from: 'conversation-upserted', to: 'default-bot-policy-checked' },
  { from: 'default-bot-policy-checked', to: 'burst-debounce', condition: 'bot aktif untuk percakapan ini' },
  { from: 'burst-debounce', to: 'fresh-bot-enabled-check', condition: 'jeda tenang habis' },
  { from: 'fresh-bot-enabled-check', to: 'rate-limit-check', condition: 'masih bot-driven' },
  { from: 'rate-limit-check', to: 'decide-and-respond', condition: 'di bawah limit atau percakapan test' },
  { from: 'decide-and-respond', to: 'escalation-keyword-check' },
  { from: 'escalation-keyword-check', to: 'handoff-alert', condition: 'kata kunci eskalasi cocok' },
  { from: 'escalation-keyword-check', to: 'escalation-llm-check', condition: 'tidak ada kata kunci' },
  { from: 'escalation-llm-check', to: 'handoff-alert', condition: 'sinyal eskalasi terdeteksi' },
  { from: 'escalation-llm-check', to: 'booking-lookup', condition: 'tidak ada sinyal eskalasi' },
  { from: 'booking-lookup', to: 'booking-context-reply', condition: 'booking ditemukan' },
  { from: 'booking-lookup', to: 'deployment-gate', condition: 'tidak ada booking' },
  { from: 'booking-context-reply', to: 'reply-verification' },
  { from: 'deployment-gate', to: 'handoff-alert', condition: 'gerbang tertutup' },
  { from: 'deployment-gate', to: 'sales-need-classification', condition: 'gerbang terbuka' },
  { from: 'sales-need-classification', to: 'destination-match' },
  { from: 'destination-match', to: 'route-integrity-gate', condition: 'destinasi teridentifikasi' },
  { from: 'destination-match', to: 'topic-classification', condition: 'tanpa destinasi' },
  { from: 'route-integrity-gate', to: 'package-pool-narrowing', condition: 'clear' },
  { from: 'route-integrity-gate', to: 'handoff-alert', condition: 'handoff' },
  { from: 'package-pool-narrowing', to: 'topic-classification' },
  { from: 'topic-classification', to: 'trip-preference-check' },
  { from: 'trip-preference-check', to: 'knowledge-resolution', condition: 'preferensi lengkap atau ditolak customer' },
  { from: 'knowledge-resolution', to: 'llm-composition', condition: 'ada fakta' },
  { from: 'knowledge-resolution', to: 'knowledge-gap-log', condition: 'tidak ada fakta' },
  { from: 'llm-composition', to: 'reply-verification' },
  { from: 'reply-verification', to: 'outbound-policy-resolution', condition: 'lolos verifikasi' },
  { from: 'reply-verification', to: 'knowledge-gap-log', condition: 'gagal dua kali' },
  { from: 'knowledge-gap-log', to: 'handoff-alert', condition: 'gagal verifikasi dua kali' },
  { from: 'outbound-policy-resolution', to: 'unofficial-send', condition: 'channel UNOFFICIAL (default)' },
  { from: 'outbound-policy-resolution', to: 'official-template-send', condition: 'channel OFFICIAL (kapabilitas khusus)' },
  { from: 'handoff-alert', to: 'outbound-policy-resolution', condition: 'pengakuan handoff dikirim ke customer' },
]

export const WHATSAPP_EXISTING_BOT_FLOW: ExistingFlowDefinition = {
  key: EXISTING_BOT_FLOW_KEY,
  name: 'WhatsApp Existing Bot',
  version: 1,
  description:
    'Pipeline bot WhatsApp yang berjalan hari ini: webhook Official masuk, keputusan disusun oleh orchestrator, balasan keluar lewat Unofficial. Read-only — halaman ini menggambarkan kode yang sudah ada, tidak mengubahnya.',
  nodes: NODES,
  edges: EDGES,
}

export const EXISTING_FLOWS: ExistingFlowDefinition[] = [WHATSAPP_EXISTING_BOT_FLOW]

/** Ringkasan untuk daftar flow (GET /api/bot-control/flows) — tanpa nodes/edges yang berat. */
export type ExistingFlowSummary = {
  key: string
  name: string
  version: number
  description: string
  nodesCount: number
  status: 'ACTIVE'
}

export function listExistingFlows(): ExistingFlowSummary[] {
  return EXISTING_FLOWS.map((flow) => ({
    key: flow.key,
    name: flow.name,
    version: flow.version,
    description: flow.description,
    nodesCount: flow.nodes.length,
    // Hardcoded ACTIVE, and deliberately not a field on the definition: every flow in this
    // registry is by construction the code that is running right now. DRAFT/ARCHIVED become
    // meaningful only in Phase 2+, when BotFlowDefinition rows can hold flows that are not.
    status: 'ACTIVE',
  }))
}

export function getExistingFlow(key: string): ExistingFlowDefinition | null {
  return EXISTING_FLOWS.find((flow) => flow.key === key) ?? null
}
