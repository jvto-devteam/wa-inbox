import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth/get-session'
import { listBotRules, type BotRule } from '@/lib/bot-control/rule-registry'

/**
 * GET /api/bot-control/rules — semua aturan bot, dengan keadaan yang SEBENARNYA berlaku.
 *
 * Registry menyimpan default statis. Tiga aturan keadaannya benar-benar hidup di baris
 * Settings, dan menampilkan default statis untuk aturan seperti itu adalah kebohongan yang
 * persis dirancang untuk dicegah halaman ini: operator akan membaca "Lewati nomor Indonesia:
 * nonaktif" padahal filternya sedang menyala.
 *
 * Kalau baris Settings gagal dibaca, aturannya tetap ditampilkan dengan nilai statis dan
 * ditandai `liveStateUnavailable` — daftar aturan yang hilang seluruhnya jauh lebih buruk
 * daripada daftar yang jujur menyebut satu kolomnya tidak terbaca.
 */
export async function GET(req: Request) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 })

  const settings = await prisma.settings
    .findUnique({ where: { id: 1 } })
    .catch((error: unknown) => {
      console.error('GET /api/bot-control/rules: gagal membaca Settings', error)
      return null
    })

  const rules = listBotRules().map((rule) => applyLiveState(rule, settings))

  return NextResponse.json({ rules })
}

type LiveSettings = { botAutoReplyAll: boolean; skipBotForIndonesianNumbers: boolean; defaultChannel: string }

type RuleResponse = BotRule & { liveStateUnavailable?: true }

function applyLiveState(rule: BotRule, settings: LiveSettings | null): RuleResponse {
  const needsLiveState = rule.enabledFromSettingsKey !== undefined || rule.configFromSettingsKey !== undefined
  if (!needsLiveState) return rule
  if (!settings) return { ...rule, liveStateUnavailable: true }

  const enabled = rule.enabledFromSettingsKey ? settings[rule.enabledFromSettingsKey] : rule.enabled

  // `configuredDefaultChannel` sengaja disimpan berdampingan dengan `policyDefaultChannel`
  // dari registry, bukan menimpanya. Keduanya bisa berbeda, dan selisih itulah temuan yang
  // berguna bagi operator — bukan sesuatu yang harus dirapikan sampai tidak terlihat.
  const config = rule.configFromSettingsKey
    ? { ...rule.config, configuredDefaultChannel: settings.defaultChannel }
    : rule.config

  return { ...rule, enabled, config }
}
