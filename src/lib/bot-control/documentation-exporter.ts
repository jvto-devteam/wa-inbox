/**
 * Generates living documentation of the bot, as Markdown, for people who do not read code.
 *
 * --- What "living" means here, and what it does not ---
 *
 * Every section is generated from the system's own current state at the moment of export: the
 * flow and rule registries in code, the Settings row, the indexed knowledge sources, the
 * template table, the deployment gate, and the recorded knowledge gaps. Nothing is transcribed
 * by hand, so the document cannot quietly describe a version of the bot that stopped existing.
 *
 * --- Secrets ---
 *
 * This module never reads `WaNumber` (access tokens, coexist API keys) or any environment
 * variable, and it never touches `Message.content` or booking payloads. It reports whether a
 * capability is CONFIGURED, never with what. The rule is enforced structurally — the queries
 * below simply do not select those columns — and asserted in documentation-exporter.test.ts,
 * because "the document must not leak a token" is the one failure that cannot be walked back
 * once the file has been emailed to an owner.
 *
 * --- Degradation ---
 *
 * A section whose data cannot be read renders as an explicit "tidak bisa dibaca" note rather
 * than as an empty heading. An owner reading a silently truncated document would conclude the
 * bot has no rules, no knowledge, and no templates.
 */
import { prisma } from '@/lib/db'
import { EXISTING_FLOWS } from '@/lib/bot-control/existing-flow-registry'
import { listBotRules, type BotRule } from '@/lib/bot-control/rule-registry'
import { checkDeploymentGate } from '@/lib/bot/deployment-gate'

export type DocumentationInput = {
  generatedAt: Date
}

const UNAVAILABLE = '_Bagian ini tidak bisa dibaca saat dokumen dibuat._'

/** Every heading, in the order guidebook §14 lists them. Exported so the test can assert it. */
export const DOCUMENTATION_SECTIONS = [
  'Ringkasan Bot',
  'Kebijakan Channel',
  'Peta Flow Existing',
  'Daftar Aturan',
  'Sumber Knowledge',
  'Ringkasan Template',
  'Pengaturan Bot',
  'Aturan Handoff',
  'Aturan Verifikasi',
  'Gap Yang Diketahui',
] as const

function heading(level: number, text: string): string {
  return `${'#'.repeat(level)} ${text}`
}

function table(headers: string[], rows: string[][]): string {
  if (rows.length === 0) return '_Tidak ada data._'
  const escape = (cell: string) => cell.replace(/\|/g, '\\|').replace(/\n+/g, ' ').trim()
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.map(escape).join(' | ')} |`),
  ].join('\n')
}

/**
 * The Settings row, reduced to the fields that describe bot behaviour.
 *
 * Deliberately NOT `findUniqueOrThrow` with a spread: selecting explicitly means a future
 * secret-bearing column added to Settings cannot appear in an exported document by accident.
 */
async function readSettings() {
  return prisma.settings
    .findUnique({
      where: { id: 1 },
      select: {
        defaultChannel: true,
        botAutoReplyAll: true,
        skipBotForIndonesianNumbers: true,
        ollamaModel: true,
        workingHoursStart: true,
        workingHoursEnd: true,
        offHoursAutoReply: true,
        catalogSyncedAt: true,
      },
    })
    .catch((error: unknown) => {
      console.error('documentation-exporter: gagal membaca Settings', error)
      return null
    })
}

function yesNo(value: boolean): string {
  return value ? 'Ya' : 'Tidak'
}

function ruleRows(rules: BotRule[]): string[][] {
  return rules.map((rule) => [
    rule.name,
    rule.category,
    rule.severity,
    rule.editable ? 'Bisa diubah' : 'Terkunci',
    rule.sourceFile,
  ])
}

export async function generateBotDocumentation(input: DocumentationInput = { generatedAt: new Date() }): Promise<string> {
  const settings = await readSettings()
  const rules = listBotRules()
  const gate = safeGate()

  const [sources, templates, gaps] = await Promise.all([
    prisma.knowledgeSource
      .findMany({
        where: { status: { not: 'ARCHIVED' } },
        orderBy: { key: 'asc' },
        select: { title: true, type: true, sourcePath: true, status: true, lastSyncedAt: true, _count: { select: { chunks: true } } },
      })
      .catch(() => null),
    // `body` is deliberately not selected: a template body can carry customer-specific text an
    // owner-facing summary has no need for, and the summary is about coverage, not content.
    prisma.template
      .findMany({ orderBy: { name: 'asc' }, select: { name: true, type: true, format: true, category: true, metaStatus: true } })
      .catch(() => null),
    prisma.knowledgeGapLog
      .groupBy({ by: ['topic', 'reason'], _count: { _all: true }, orderBy: { _count: { topic: 'desc' } }, take: 50 })
      .catch(() => null),
  ])

  const parts: string[] = []

  parts.push(heading(1, 'Dokumentasi Bot WhatsApp — wa-inbox'))
  parts.push(
    `_Dokumen ini dibuat otomatis dari kondisi sistem pada ${input.generatedAt.toLocaleString('id-ID')}. Jangan diedit manual — jalankan ekspor ulang._`
  )

  // 1. Ringkasan Bot
  parts.push(heading(2, DOCUMENTATION_SECTIONS[0]))
  if (!settings) {
    parts.push(UNAVAILABLE)
  } else {
    parts.push(
      table(
        ['Hal', 'Kondisi'],
        [
          ['Mode bot', settings.botAutoReplyAll ? 'Aktif untuk semua chat' : 'Nonaktif — diaktifkan per percakapan'],
          ['Model LLM', settings.ollamaModel],
          ['Lewati nomor Indonesia', yesNo(settings.skipBotForIndonesianNumbers)],
          ['Katalog terakhir disinkronkan', settings.catalogSyncedAt?.toLocaleString('id-ID') ?? 'Belum pernah'],
          [
            'Gerbang persetujuan deployment',
            gate === null ? 'Tidak bisa dibaca' : gate.readyForApproval ? 'Terbuka' : `Tertutup: ${gate.blocking.join(', ')}`,
          ],
        ]
      )
    )
  }

  // 2. Kebijakan Channel
  parts.push(heading(2, DOCUMENTATION_SECTIONS[1]))
  parts.push(
    'WhatsApp Official dipakai sebagai webhook untuk MENERIMA pesan. Pengiriman harian bot dan agent lewat jalur Unofficial/coexistence. Official disediakan untuk kapabilitas resmi: template, campaign legal, utility/auth.'
  )
  if (settings) {
    parts.push(
      table(
        ['Hal', 'Nilai'],
        [
          ['Default outbound menurut kebijakan', 'UNOFFICIAL'],
          ['Default outbound yang dikonfigurasi', settings.defaultChannel],
        ]
      )
    )
    // Surfaced, not smoothed over: policy and configuration genuinely can disagree, and the
    // owner reading this document is exactly who should know when they do.
    if (settings.defaultChannel !== 'UNOFFICIAL') {
      parts.push(
        `> **Perlu diperhatikan:** kebijakan tertulis menetapkan Unofficial sebagai default, tetapi konfigurasi saat ini adalah ${settings.defaultChannel}.`
      )
    }
  }
  parts.push(table(['Aturan', 'Kategori', 'Tingkat', 'Status', 'Sumber'], ruleRows(rules.filter((r) => r.category === 'Channel Policy'))))

  // 3. Peta Flow Existing
  parts.push(heading(2, DOCUMENTATION_SECTIONS[2]))
  for (const flow of EXISTING_FLOWS) {
    parts.push(heading(3, `${flow.name} (v${flow.version}, ${flow.nodes.length} langkah)`))
    parts.push(flow.description)
    parts.push(
      table(
        ['#', 'Langkah', 'Jenis', 'Sumber kode', 'Kemungkinan hasil'],
        [...flow.nodes]
          .sort((a, b) => a.order - b.order)
          .map((node) => [String(node.order), node.name, node.type, node.sourceFile, node.possibleOutputs.join('; ')])
      )
    )
  }

  // 4. Daftar Aturan
  parts.push(heading(2, DOCUMENTATION_SECTIONS[3]))
  parts.push(table(['Aturan', 'Kategori', 'Tingkat', 'Status', 'Sumber'], ruleRows(rules)))

  // 5. Sumber Knowledge
  parts.push(heading(2, DOCUMENTATION_SECTIONS[4]))
  if (sources === null) {
    parts.push(UNAVAILABLE)
  } else if (sources.length === 0) {
    parts.push('_Belum ada sumber knowledge yang ter-index. Jalankan "Index ulang katalog" di Knowledge Explorer._')
  } else {
    parts.push(
      table(
        ['Judul', 'Tipe', 'Path', 'Status', 'Jumlah chunk', 'Terakhir sinkron'],
        sources.map((source) => [
          source.title,
          source.type,
          source.sourcePath ?? '—',
          source.status,
          String(source._count.chunks),
          source.lastSyncedAt?.toLocaleString('id-ID') ?? 'Belum pernah',
        ])
      )
    )
  }

  // 6. Ringkasan Template
  parts.push(heading(2, DOCUMENTATION_SECTIONS[5]))
  if (templates === null) {
    parts.push(UNAVAILABLE)
  } else {
    parts.push(
      table(
        ['Nama', 'Tipe', 'Format', 'Kategori', 'Status Meta'],
        templates.map((t) => [t.name, t.type, t.format, t.category ?? '—', t.metaStatus])
      )
    )
  }

  // 7. Pengaturan Bot
  parts.push(heading(2, DOCUMENTATION_SECTIONS[6]))
  if (!settings) {
    parts.push(UNAVAILABLE)
  } else {
    parts.push(
      table(
        ['Pengaturan', 'Nilai'],
        [
          ['Jam kerja mulai', settings.workingHoursStart ?? 'Tidak diatur'],
          ['Jam kerja selesai', settings.workingHoursEnd ?? 'Tidak diatur'],
          ['Balasan di luar jam kerja', settings.offHoursAutoReply ?? 'Tidak diatur'],
        ]
      )
    )
  }

  // 8. Aturan Handoff
  parts.push(heading(2, DOCUMENTATION_SECTIONS[7]))
  parts.push(
    'Setiap handoff mengirim satu pengakuan generik ke pelanggan, mematikan bot untuk percakapan itu, lalu memunculkan notifikasi ke agent. Alasan spesifiknya disimpan di trace, tidak pernah dikutip ke pelanggan.'
  )
  parts.push(table(['Aturan', 'Kategori', 'Tingkat', 'Status', 'Sumber'], ruleRows(rules.filter((r) => r.category === 'Handoff'))))

  // 9. Aturan Verifikasi
  parts.push(heading(2, DOCUMENTATION_SECTIONS[8]))
  parts.push(
    'Setiap angka rupiah dan setiap URL pada draft dicocokkan dengan fakta yang benar-benar ada di knowledge. Draft yang gagal dikirim ulang ke model dengan instruksi perbaikan; gagal dua kali berturut-turut diserahkan ke agen, bukan dikirim apa adanya.'
  )
  parts.push(table(['Aturan', 'Kategori', 'Tingkat', 'Status', 'Sumber'], ruleRows(rules.filter((r) => r.category === 'Safety'))))

  // 10. Gap Yang Diketahui
  parts.push(heading(2, DOCUMENTATION_SECTIONS[9]))
  if (gaps === null) {
    parts.push(UNAVAILABLE)
  } else if (gaps.length === 0) {
    parts.push('_Belum ada knowledge gap yang tercatat._')
  } else {
    parts.push(
      table(
        ['Topik', 'Alasan', 'Jumlah'],
        gaps.map((gap) => [gap.topic, gap.reason, String(gap._count._all)])
      )
    )
  }

  parts.push(`---\n\n_Dokumen dibuat: ${input.generatedAt.toISOString()}_`)

  return parts.join('\n\n')
}

/** The deployment gate reads a file that is absent on a fresh checkout; never let that throw. */
function safeGate(): { readyForApproval: boolean; blocking: string[] } | null {
  try {
    return checkDeploymentGate()
  } catch (error) {
    console.error('documentation-exporter: gagal membaca deployment gate', error)
    return null
  }
}
