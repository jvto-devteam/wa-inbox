/**
 * The bot's operating rules, written down.
 *
 * Every rule here already governs production behaviour — it is enforced by the code named in
 * `sourceFile`/`sourceRef`, not by this file. What was missing was any way for an operator to
 * SEE the rules: "does the bot invent prices?" and "why did it hand off?" were questions only
 * answerable by reading `orchestrator.ts`.
 *
 * `editable` is the load-bearing field, and it is a safety boundary rather than a UI hint.
 * A rule is `editable: false` when flipping it from a web form would either break a promise we
 * have made to customers (the bot may not quote a price it cannot source) or would require code
 * changes to mean anything at all (the debounce window is not read from a settings row). The
 * Rules page must not render a toggle for those — an inert switch that appears to work is worse
 * than no switch, because an operator will believe they turned something off.
 *
 * `enabled` reflects what is true TODAY. For the three rules whose state genuinely lives in the
 * database (`bot.skip_indonesian_numbers` above all), the value here is the static default; the
 * live value comes from Settings and is layered on by the API route, which is why
 * `enabledFromSettingsKey` exists.
 */

export type RuleSeverity = 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL'

/**
 * Settings columns a rule's `enabled` may be read from. Narrowed to a union rather than
 * `string` on purpose: a typo'd column name would otherwise sail through review and silently
 * leave the rule stuck on its static default forever, which is exactly the class of "the UI
 * says it is off but it is on" bug this whole page exists to prevent.
 */
export type SettingsBooleanKey = 'botAutoReplyAll' | 'skipBotForIndonesianNumbers'

export type BotRule = {
  key: string
  name: string
  category: string
  description: string
  sourceFile: string
  sourceRef?: string
  severity: RuleSeverity
  editable: boolean
  enabled: boolean
  /**
   * Name of the `Settings` column that actually decides this rule's live state, when one
   * exists. Rules without it are enforced unconditionally by code, and their `enabled` is
   * always true — there is no switch anywhere that turns them off.
   */
  enabledFromSettingsKey?: SettingsBooleanKey
  config?: Record<string, unknown>
  /**
   * Name of the `Settings` column carrying this rule's live configured VALUE (as opposed to
   * an on/off state). The route merges it into `config` so the UI shows what is configured,
   * not what the policy wishes were configured.
   */
  configFromSettingsKey?: 'defaultChannel'
}

export const BOT_RULES: BotRule[] = [
  {
    key: 'channel.official_inbound_only',
    name: 'Official hanya untuk inbound',
    category: 'Channel Policy',
    description:
      'WhatsApp Official Cloud API dipakai sebagai webhook utama untuk MENERIMA pesan dan event Meta. Jalur Unofficial tidak menerima webhook sama sekali, sehingga tidak ada pesan masuk yang bisa datang dari sana.',
    sourceFile: 'src/app/api/webhooks/meta/route.ts',
    sourceRef: 'POST',
    severity: 'CRITICAL',
    editable: false,
    enabled: true,
  },
  {
    key: 'channel.unofficial_outbound_default',
    name: 'Unofficial sebagai outbound default',
    category: 'Channel Policy',
    description:
      'Pesan agent dan bot dikirim melalui Unofficial/coexistence secara default. Official dipilih hanya bila pemanggil memintanya secara eksplisit.',
    sourceFile: 'src/lib/channel-router.ts',
    sourceRef: 'resolveChannel',
    severity: 'CRITICAL',
    // Editable per guidebook §9: yang boleh diubah adalah PILIHAN default-nya (lewat
    // Settings.defaultChannel), bukan keberadaan aturannya. UI mengubah nilai default,
    // tidak menghapus kebijakan channel.
    editable: true,
    enabled: true,
    // Nilai kebijakan, bukan nilai runtime. Route API melapisi Settings.defaultChannel yang
    // sebenarnya ke sini, dan keduanya bisa BERBEDA: kolom itu default-nya OFFICIAL di skema,
    // sementara kebijakan yang tertulis adalah UNOFFICIAL. Perbedaan itu justru yang perlu
    // dilihat operator, jadi jangan disamarkan dengan menampilkan angan-angan.
    config: { policyDefaultChannel: 'UNOFFICIAL' },
    configFromSettingsKey: 'defaultChannel',
  },
  {
    key: 'channel.official_reserved_for_capabilities',
    name: 'Official khusus kapabilitas resmi',
    category: 'Channel Policy',
    description:
      'Official send hanya dipakai untuk template official, campaign legal, utility/auth, atau fallback tertentu — bukan jalur balasan harian. Fitur official-only tidak boleh dipaksa lewat Unofficial; bila provider tidak mendukung, UI harus fallback ke teks.',
    sourceFile: 'src/lib/meta/messages.ts',
    severity: 'HIGH',
    editable: true,
    enabled: true,
  },
  {
    key: 'bot.no_invented_price',
    name: 'Tidak boleh mengarang harga',
    category: 'Safety',
    description:
      'Bot tidak boleh menyebut harga yang tidak ada di knowledge/catalog/booking data. Setiap angka rupiah di draft dicocokkan dengan grounding; gagal dua kali berturut-turut berakhir handoff, bukan dikirim apa adanya.',
    sourceFile: 'src/lib/bot/reply-verifier.ts',
    sourceRef: 'verifyReply',
    severity: 'CRITICAL',
    // Tidak akan pernah editable. Mematikan ini berarti mengizinkan bot mengutip angka yang
    // tidak bisa dipertanggungjawabkan ke customer yang akan membayarnya.
    editable: false,
    enabled: true,
  },
  {
    key: 'bot.no_invented_url',
    name: 'Tidak boleh mengarang URL',
    category: 'Safety',
    description:
      'Bot tidak boleh menyebut URL yang tidak ada di grounding. Diverifikasi oleh mekanisme yang sama dengan pemeriksaan harga.',
    sourceFile: 'src/lib/bot/reply-verifier.ts',
    sourceRef: 'verifyReply',
    severity: 'CRITICAL',
    editable: false,
    enabled: true,
  },
  {
    key: 'bot.handoff_on_human_request',
    name: 'Handoff saat customer minta manusia',
    category: 'Handoff',
    description:
      'Jika customer meminta bicara dengan manusia/agent atau menunjukkan komplain/frustrasi, bot melakukan handoff: mengirim satu pengakuan generik, mematikan botEnabled percakapan itu, lalu menyiarkan handoff.alert ke agent.',
    sourceFile: 'src/lib/bot/escalation-classifier.ts',
    sourceRef: 'detectsAdditionalEscalationSignal',
    severity: 'HIGH',
    // Editable menyangkut lapisan LLM tambahannya (bisa dimatikan bila model bermasalah).
    // Gerbang kata kunci eksplisit tetap jalan tanpa syarat.
    editable: true,
    enabled: true,
  },
  {
    key: 'bot.booking_context_first',
    name: 'Konteks booking didahulukan',
    category: 'Decision',
    description:
      'Jika booking ditemukan, bot menjawab berdasarkan data booking sebelum memakai katalog umum. Tanggal, jam jemput, dan hotel milik customer selalu mengalahkan angka generik dari paket.',
    sourceFile: 'src/lib/bot/orchestrator.ts',
    sourceRef: 'runBookingContextMode',
    severity: 'HIGH',
    editable: false,
    enabled: true,
  },
  {
    key: 'bot.skip_indonesian_numbers',
    name: 'Lewati nomor Indonesia',
    category: 'Market Policy',
    description:
      'Jika setting aktif, bot tidak membalas otomatis nomor +62 — percakapan tetap masuk inbox untuk ditangani agent. Dipakai saat pasar domestik ditangani manusia sementara bot melayani customer internasional.',
    sourceFile: 'src/lib/inbound.ts',
    sourceRef: 'defaultBotEnabled',
    severity: 'NORMAL',
    editable: true,
    // Nilai default statis. Keadaan sebenarnya dibaca dari Settings oleh route API — lihat
    // enabledFromSettingsKey.
    enabled: false,
    enabledFromSettingsKey: 'skipBotForIndonesianNumbers',
  },
  {
    key: 'bot.burst_debounce',
    name: 'Gabungkan pesan beruntun',
    category: 'Delivery Quality',
    description:
      'Pesan customer yang datang beruntun ditahan sampai jeda tenang habis lalu digabung menjadi satu input, sehingga bot menjawab satu pikiran utuh alih-alih membalas tiap potongan kalimat.',
    sourceFile: 'src/lib/inbound.ts',
    sourceRef: 'scheduleBotRun',
    severity: 'NORMAL',
    // Jendela debounce adalah konstanta modul, bukan baris settings. Toggle di UI tidak akan
    // mengubah apa pun sampai nilainya dipindahkan ke database — itu pekerjaan fase lain.
    editable: false,
    enabled: true,
  },
  {
    key: 'bot.rate_limit',
    name: 'Batas auto-reply per percakapan',
    category: 'Abuse Protection',
    description:
      'Bot membatasi jumlah auto-reply per percakapan dalam window tertentu. Dicek sebelum decision engine dijalankan sehingga giliran yang diblok tidak memakan biaya LLM sama sekali. Percakapan sandbox dikecualikan.',
    sourceFile: 'src/lib/bot/rate-limiter.ts',
    sourceRef: 'checkAndRecordRateLimit',
    severity: 'HIGH',
    editable: false,
    enabled: true,
  },
]

export function listBotRules(): BotRule[] {
  // Salinan dangkal supaya konsumen (route API yang melapisi nilai Settings) tidak bisa
  // memutasi registry modul ini dan membocorkan perubahan ke request berikutnya di server
  // yang berumur panjang.
  return BOT_RULES.map((rule) => ({ ...rule }))
}

export function getBotRule(key: string): BotRule | null {
  return BOT_RULES.find((rule) => rule.key === key) ?? null
}

/** Kategori unik untuk dropdown filter, dalam urutan kemunculan pertama di registry. */
export function listRuleCategories(): string[] {
  return [...new Set(BOT_RULES.map((rule) => rule.category))]
}
