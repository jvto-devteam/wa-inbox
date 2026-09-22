/**
 * Satu kali: ganti tautan portal booking di template sistem dari
 *   https://javavolcano-touroperator.com/my-booking/{booking_slug}
 * ke
 *   https://jvto.me/b/{booking_short}
 *
 *   npx tsx scripts/switch-booking-short-link.ts            # dry run: cetak rencana
 *   npx tsx scripts/switch-booking-short-link.ts --apply    # tulis
 *
 * Kenapa script, bukan form: PATCH /api/system-templates/[key] sengaja menolak variabel yang
 * belum ada di baris (daftar variabel = kontrak dengan program pemanggil). booking_short kini
 * dikirim di setiap tempat yang mengirim booking_slug (new-backoffice BookingController,
 * javavolcano-touroperator ReminderPayment/TripInformation/TripMedia/KlookEmailExtractorController/
 * thirdParty/XenditController), jadi di sinilah ia dideklarasikan. Seed tidak diubah:
 * seed-parity.test.ts mengunci teks port PHP aslinya, dan seed bersifat create-only — baris
 * produksi milik operator.
 *
 * Hanya mengganti string tautan yang PERSIS sama. Template yang tautannya sudah diubah operator
 * dilewati dan dilaporkan, tidak ditimpa. Aman dijalankan ulang (idempoten).
 */
import type { SystemTemplateVariable } from '@/lib/system-templates/types'

export const OLD_LINK = 'https://javavolcano-touroperator.com/my-booking/{booking_slug}'
export const NEW_LINK = 'https://jvto.me/b/{booking_short}'

export const TARGET_KEYS = [
  'booking_confirmed_backoffice_jvto',
  'booking_confirmed_backoffice_klook',
  'booking_confirmed_klook_email',
  'payment_received_balance',
  'payment_received_first',
  'payment_reminder_balance',
  'trip_information',
  'trip_concluded',
] as const

export const BOOKING_SHORT_VARIABLE: SystemTemplateVariable = {
  name: 'booking_short',
  required: true,
  example: 'Ab3dE5fG7h',
  description: 'Kolom bookings.url_short — segmen terakhir tautan https://jvto.me/b/<kode>.',
}

export type TemplateRow = { key: string; body: string; variables: SystemTemplateVariable[] }

export type SwitchPlan = {
  update: { key: string; body: string; variables: SystemTemplateVariable[] }[]
  alreadySwitched: string[]
  skipped: { key: string; reason: string }[]
}

export function planSwitch(rows: TemplateRow[]): SwitchPlan {
  const plan: SwitchPlan = { update: [], alreadySwitched: [], skipped: [] }
  const byKey = new Map(rows.map((row) => [row.key, row]))

  for (const key of TARGET_KEYS) {
    const row = byKey.get(key)
    if (!row) {
      plan.skipped.push({ key, reason: 'template tidak ada di database' })
      continue
    }
    if (row.body.includes(OLD_LINK)) {
      const variables = row.variables.some((variable) => variable.name === BOOKING_SHORT_VARIABLE.name)
        ? row.variables
        : [...row.variables, BOOKING_SHORT_VARIABLE]
      plan.update.push({ key, body: row.body.split(OLD_LINK).join(NEW_LINK), variables })
      continue
    }
    if (row.body.includes(NEW_LINK)) {
      plan.alreadySwitched.push(key)
      continue
    }
    plan.skipped.push({ key, reason: 'tautan lama tidak ditemukan persis — kemungkinan sudah diubah operator' })
  }

  return plan
}

async function main() {
  const apply = process.argv.includes('--apply')
  const { config } = await import('dotenv')
  config({ quiet: true })
  const { prisma } = await import('@/lib/db')
  const { parseVariables } = await import('@/lib/system-templates/types')
  const { validateTemplateBody } = await import('@/lib/system-templates/render')
  const { writeBotAuditLog } = await import('@/lib/bot-control/audit')

  try {
    const rows = await prisma.systemTemplate.findMany({
      where: { key: { in: [...TARGET_KEYS] } },
      select: { id: true, key: true, body: true, variables: true },
    })
    const plan = planSwitch(rows.map((row) => ({ key: row.key, body: row.body, variables: parseVariables(row.variables) })))

    for (const key of plan.alreadySwitched) console.log(`= ${key} (sudah memakai jvto.me)`)
    for (const { key, reason } of plan.skipped) console.log(`! ${key} dilewati: ${reason}`)
    for (const { key, body, variables } of plan.update) {
      const problems = validateTemplateBody(body, variables)
      if (problems.length > 0) throw new Error(`${key}: ${problems.join(' ')}`)
      console.log(`${apply ? '+' : '~'} ${key}`)
    }

    if (!apply) {
      console.log(`\nDry run: ${plan.update.length} akan diubah. Tambah --apply untuk menulis.`)
      return
    }

    const idByKey = new Map(rows.map((row) => [row.key, row.id]))
    for (const { key, body, variables } of plan.update) {
      await prisma.$transaction(async (tx) => {
        await tx.systemTemplate.update({ where: { key }, data: { body, variables } })
        await writeBotAuditLog(
          {
            action: 'UPDATE',
            entityType: 'SYSTEM_TEMPLATE',
            entityId: idByKey.get(key) ?? null,
            entityKey: key,
            actorId: null,
            actorName: 'script switch-booking-short-link',
            reason: 'Tautan portal booking diganti ke https://jvto.me/b/{booking_short}',
          },
          tx
        )
        // Dijalankan dari laptop ke DB VPS: satu transaksi pernah makan 31 detik, jauh di atas
        // default 5 detik Prisma. Tiap template tetap satu transaksi sendiri.
      }, { maxWait: 30_000, timeout: 120_000 })
    }
    console.log(`\n${plan.update.length} diubah.`)
  } finally {
    await prisma.$disconnect()
  }
}

// Importing planSwitch from a test must never touch a database.
if (require.main === module) {
  main().catch((error) => {
    console.error('Gagal:', error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
