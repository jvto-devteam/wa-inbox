import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth/get-session'
import { listBotRules, type BotRule } from '@/lib/bot-control/rule-registry'
import { ruleEditSurface } from '@/lib/bot-control/rule-config'

/**
 * GET /api/bot-control/rules — semua aturan bot, dengan keadaan yang SEBENARNYA berlaku.
 *
 * Tiga lapis, dan urutannya penting:
 *
 *   1. Registry statis (`rule-registry.ts`) memutuskan aturan apa saja yang ADA, di file mana
 *      ia ditegakkan, dan apakah ia `editable`. Baris database tidak boleh menambah aturan
 *      yang tidak ada kodenya, dan tidak boleh menaikkan `editable`-nya sendiri.
 *   2. `BotRuleSetting` melapisi `enabled`/`config` yang sudah dipublish, plus status draft.
 *   3. Baris `Settings` melapisi tiga aturan yang keadaannya memang masih hidup di sana.
 *
 * Lapis 3 tetap ada dan sengaja belum dipindahkan. Memindahkan `skipBotForIndonesianNumbers`
 * ke tabel rule berarti mengubah apa yang dibaca `src/lib/inbound.ts` saat runtime — perubahan
 * perilaku bot di fase yang seharusnya hanya membangun lapisan manajemennya. Selama halaman
 * Settings masih menulis ke kolom itu, kolom itulah kebenarannya, dan menampilkan angka lain
 * adalah persis kebohongan yang halaman ini dibuat untuk mencegah.
 *
 * Kalau salah satu sumber gagal dibaca, aturannya tetap ditampilkan dengan nilai statis dan
 * ditandai `liveStateUnavailable` — daftar aturan yang hilang seluruhnya jauh lebih buruk
 * daripada daftar yang jujur menyebut satu sumbernya tidak terbaca.
 */
export async function GET(req: Request) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 })

  const settings = await prisma.settings.findUnique({ where: { id: 1 } }).catch((error: unknown) => {
    console.error('GET /api/bot-control/rules: gagal membaca Settings', error)
    return null
  })

  const [storedRules, storeFailed] = await prisma.botRuleSetting
    .findMany()
    .then((rows) => [rows, false] as const)
    .catch((error: unknown) => {
      console.error('GET /api/bot-control/rules: gagal membaca BotRuleSetting', error)
      return [[], true] as const
    })

  const storedByKey = new Map(storedRules.map((row) => [row.key, row]))

  const rules = listBotRules().map((rule) =>
    applyLiveState(rule, settings, storedByKey.get(rule.key) ?? null, storeFailed)
  )

  return NextResponse.json({ rules })
}

type LiveSettings = { botAutoReplyAll: boolean; skipBotForIndonesianNumbers: boolean; defaultChannel: string }

type StoredRule = {
  id: string
  status: string
  enabled: boolean
  config: unknown
  draftConfig: unknown
  draftEnabled: boolean | null
  draftUpdatedBy: string | null
  draftUpdatedAt: Date | null
  publishedAt: Date | null
  releaseId: string | null
  runtimeSource: string | null
}

type RuleResponse = BotRule & {
  liveStateUnavailable?: true
  /** PUBLISHED / DRAFT / REVIEW / APPROVED / REJECTED, or 'PUBLISHED' when never seeded. */
  status: string
  hasDraft: boolean
  draftEnabled: boolean | null
  draftConfig: Record<string, unknown> | null
  draftUpdatedBy: string | null
  draftUpdatedAt: string | null
  releaseId: string | null
  runtimeSource: string | null
  /** Null when the rule may not be edited at all — the UI renders no controls for those. */
  editSurface: { canToggleEnabled: boolean; fields: readonly string[] } | null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function applyLiveState(
  rule: BotRule,
  settings: LiveSettings | null,
  stored: StoredRule | null,
  storeFailed: boolean
): RuleResponse {
  const needsSettings = rule.enabledFromSettingsKey !== undefined || rule.configFromSettingsKey !== undefined

  let enabled = rule.enabled
  let config = rule.config

  // Database layer first, Settings layer on top: for the handful of rules that still live in
  // Settings, that column is what the running code reads, so it has the last word.
  if (stored) {
    enabled = stored.enabled
    config = asRecord(stored.config) ?? config
  }

  if (needsSettings && settings) {
    if (rule.enabledFromSettingsKey) enabled = settings[rule.enabledFromSettingsKey]
    // `configuredDefaultChannel` sengaja disimpan berdampingan dengan `policyDefaultChannel`
    // dari registry, bukan menimpanya. Keduanya bisa berbeda, dan selisih itulah temuan yang
    // berguna bagi operator — bukan sesuatu yang harus dirapikan sampai tidak terlihat.
    if (rule.configFromSettingsKey) config = { ...config, configuredDefaultChannel: settings.defaultChannel }
  }

  // Scoped to what actually became unknown. A failed Settings read only clouds the rules that
  // read from Settings; a failed BotRuleSetting read clouds ALL of them, because any rule's
  // enabled/config could have been overridden by a row that could not be fetched.
  const unavailable = (needsSettings && !settings) || storeFailed

  return {
    ...rule,
    enabled,
    config,
    ...(unavailable ? { liveStateUnavailable: true as const } : {}),
    status: stored?.status ?? 'PUBLISHED',
    // A draft exists when the row is not in its published resting state. `draftEnabled` alone
    // is not enough: a draft that only changes config leaves it null.
    hasDraft: stored != null && stored.status !== 'PUBLISHED' && stored.status !== 'REJECTED',
    draftEnabled: stored?.draftEnabled ?? null,
    draftConfig: asRecord(stored?.draftConfig ?? null),
    draftUpdatedBy: stored?.draftUpdatedBy ?? null,
    draftUpdatedAt: stored?.draftUpdatedAt?.toISOString() ?? null,
    releaseId: stored?.releaseId ?? null,
    runtimeSource: stored?.runtimeSource ?? null,
    // Derived from the registry, never from the stored row — see rule-config.ts.
    editSurface: ruleEditSurface(rule.key),
  }
}
