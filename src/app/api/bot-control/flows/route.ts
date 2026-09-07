import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth/get-session'
import { listExistingFlows } from '@/lib/bot-control/existing-flow-registry'
import { editableFieldsFor } from '@/lib/bot-control/flow-config'

/**
 * GET /api/bot-control/flows — daftar flow bot yang berjalan, dengan keadaan pengelolaannya.
 *
 * Dua lapis, dan urutannya penting: registry statis memutuskan flow apa yang ADA dan berapa
 * node di dalamnya (itu control flow di kode, bukan data), lalu baris `BotFlowDefinition`
 * melapisi level editable, versi aktif, dan draft yang tertunda. Baris database TIDAK boleh
 * memunculkan flow yang tidak ada kodenya — konfigurasinya tidak akan mengonfigurasi apa pun.
 *
 * Sesi saja, bukan admin: guidebook §19 mensyaratkan AGENT bisa membaca seluruh area Bot
 * Control. Tidak ada yang rahasia di sini — hanya nama langkah dan path file.
 *
 * Kalau tabelnya gagal dibaca, daftarnya tetap tampil dari registry dan ditandai
 * `managementUnavailable` — daftar flow yang hilang seluruhnya jauh lebih buruk daripada
 * daftar yang jujur menyebut satu sumbernya tidak terbaca.
 */
export async function GET(req: Request) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 })

  const [definitions, failed] = await prisma.botFlowDefinition
    .findMany({
      include: {
        // Newest first: the headline state is the latest version, published or not.
        versions: { orderBy: { version: 'desc' }, take: 1 },
      },
    })
    .then((rows) => [rows, false] as const)
    .catch((error: unknown) => {
      console.error('GET /api/bot-control/flows: gagal membaca BotFlowDefinition', error)
      return [[], true] as const
    })

  const byKey = new Map(definitions.map((row) => [row.key, row]))

  const flows = listExistingFlows().map((flow) => {
    const definition = byKey.get(flow.key)
    const latest = definition?.versions[0] ?? null
    const published = latest?.status === 'PUBLISHED' ? latest : null
    // READ_ONLY when unseeded: opening a flow for editing has to be deliberate, so a missing
    // row fails closed rather than offering controls the runtime would not honour.
    const editableLevel = definition?.editableLevel ?? 'READ_ONLY'

    return {
      ...flow,
      editableLevel,
      editableFields: editableFieldsFor(editableLevel),
      runtimeSource: definition?.runtimeSource ?? 'code',
      managementStatus: definition?.status ?? null,
      activeVersion: published?.version ?? null,
      lastPublishedAt: published?.publishedAt?.toISOString() ?? null,
      // A pending version is one that is neither live nor discarded.
      draftVersion:
        latest && ['DRAFT', 'REVIEW', 'APPROVED'].includes(latest.status)
          ? { id: latest.id, version: latest.version, status: latest.status }
          : null,
      // Phase F fills this in; saying null is honest, saying "PASSED" would not be.
      lastTestStatus: null,
      ...(failed ? { managementUnavailable: true as const } : {}),
    }
  })

  return NextResponse.json({ flows })
}
