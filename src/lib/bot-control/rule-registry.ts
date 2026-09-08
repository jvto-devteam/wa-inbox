/**
 * The bot's operating rules, written down.
 *
 * --- This file is documentation, and that is the whole of its job ---
 *
 * Every rule here already governs production behaviour — it is enforced by the code named in
 * `sourceFile`/`sourceRef`, not by this file. What was missing was any way for an operator to
 * SEE the rules: "does the bot invent prices?" and "why did it hand off?" were questions only
 * answerable by reading `orchestrator.ts`.
 *
 * Eight of the ten rules below are hardcoded behaviour with no switch anywhere. They used to
 * carry an `editable` flag, a database row each, six API routes and a
 * draft → review → approve → publish state machine — for ten rows that will never become
 * eleven, eight of which nothing could change anyway. All of that is gone. A list of ten
 * sentences describing hardcoded behaviour is best kept as exactly that: a list of ten
 * sentences.
 *
 * --- The two that really are switches ---
 *
 * `bot.skip_indonesian_numbers` and `bot.handoff_on_human_request` are the only two rules that
 * reach the runtime as a decision rather than as prose. Each is one boolean column on
 * `Settings`, named in `settingsKey`, flipped on /chatbot with the same edit-save-live pattern
 * as every other bot setting. The Rules page reads that column to show the live state; it does
 * not offer to change it, because there is exactly one place that does and a second writer
 * would only let the two disagree.
 */

export type RuleSeverity = 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL'

/**
 * `Settings` columns that switch a rule on and off.
 *
 * Narrowed to a union rather than `string` on purpose: a typo'd column name would otherwise
 * sail through review and leave the Rules page reporting a state that belongs to no column at
 * all — exactly the "the UI says it is off but it is on" bug this page exists to prevent.
 */
export type RuleSettingsKey = 'skipBotForIndonesianNumbers' | 'handoffOnHumanRequest'

export type BotRule = {
  key: string
  name: string
  category: string
  description: string
  sourceFile: string
  sourceRef?: string
  severity: RuleSeverity
  /**
   * The `Settings` column that decides this rule's live state, for the two rules that have
   * one. Absent means the rule is enforced unconditionally by code — there is no switch
   * anywhere, and the page says so rather than implying one exists somewhere off-screen.
   */
  settingsKey?: RuleSettingsKey
  /**
   * Where this rule's behaviour is actually managed, when it is not a `Settings` column.
   *
   * Only one rule has one now: the default outbound channel, which is `Settings.defaultChannel`
   * on /settings. Pointing at that page is the difference between "terkunci" and "terkunci, and
   * here is who holds the key".
   */
  managedIn?: { href: string; label: string }
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
  },
  {
    key: 'channel.unofficial_outbound_default',
    name: 'Unofficial sebagai outbound default',
    category: 'Channel Policy',
    description:
      'Pesan agent dan bot dikirim melalui Unofficial/coexistence secara default. Official dipilih hanya bila pemanggil memintanya secara eksplisit, atau bila kemampuannya memang hanya ada di Official. Nilai defaultnya dibaca dari Settings.defaultChannel oleh resolveChannel, bukan dari halaman ini.',
    sourceFile: 'src/lib/channel-router.ts',
    sourceRef: 'resolveChannel',
    severity: 'CRITICAL',
    managedIn: { href: '/settings', label: 'Pengaturan' },
  },
  {
    key: 'channel.official_reserved_for_capabilities',
    name: 'Official khusus kapabilitas resmi',
    category: 'Channel Policy',
    description:
      'Official send hanya dipakai untuk template official, campaign legal, utility/auth, atau fallback tertentu — bukan jalur balasan harian. Fitur official-only tidak boleh dipaksa lewat Unofficial; bila provider tidak mendukung, UI harus fallback ke teks. Matriksnya statis di channel-capabilities.ts dan tidak bisa disunting lewat form: kemampuan mana yang ada adalah fakta tentang API provider, bukan pilihan.',
    sourceFile: 'src/lib/bot-control/channel-capabilities.ts',
    sourceRef: 'preferredChannelForCapability',
    severity: 'HIGH',
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
  },
  {
    key: 'bot.handoff_on_human_request',
    name: 'Handoff saat customer minta manusia',
    category: 'Handoff',
    description:
      'Jika customer meminta bicara dengan manusia/agent atau menunjukkan komplain/frustrasi, bot melakukan handoff: mengirim satu pengakuan generik, mematikan botEnabled percakapan itu, lalu menyiarkan handoff.alert ke agent. Sakelarnya hanya mematikan lapisan LLM tambahan — gerbang kata kunci eksplisit tetap jalan tanpa syarat.',
    sourceFile: 'src/lib/bot/escalation-classifier.ts',
    sourceRef: 'detectsAdditionalEscalationSignal',
    severity: 'HIGH',
    settingsKey: 'handoffOnHumanRequest',
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
    settingsKey: 'skipBotForIndonesianNumbers',
  },
  {
    key: 'bot.burst_debounce',
    name: 'Gabungkan pesan beruntun',
    category: 'Delivery Quality',
    description:
      'Pesan customer yang datang beruntun ditahan sampai jeda tenang habis lalu digabung menjadi satu input, sehingga bot menjawab satu pikiran utuh alih-alih membalas tiap potongan kalimat. Jendela jedanya konstanta modul, bukan setelan.',
    sourceFile: 'src/lib/inbound.ts',
    sourceRef: 'scheduleBotRun',
    severity: 'NORMAL',
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
  },
]

export function listBotRules(): BotRule[] {
  // Salinan dangkal supaya konsumen tidak bisa memutasi registry modul ini dan membocorkan
  // perubahan ke request berikutnya di server yang berumur panjang.
  return BOT_RULES.map((rule) => ({ ...rule }))
}

export function getBotRule(key: string): BotRule | null {
  return BOT_RULES.find((rule) => rule.key === key) ?? null
}

/** Kategori unik untuk dropdown filter, dalam urutan kemunculan pertama di registry. */
export function listRuleCategories(): string[] {
  return [...new Set(BOT_RULES.map((rule) => rule.category))]
}
