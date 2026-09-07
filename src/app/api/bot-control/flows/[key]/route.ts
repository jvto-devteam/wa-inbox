import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth/get-session'
import { getExistingFlow } from '@/lib/bot-control/existing-flow-registry'
import { editableFieldsFor, readFlowSafeConfig } from '@/lib/bot-control/flow-config'

/**
 * GET /api/bot-control/flows/[key] — satu flow lengkap: node map, versi aktif, dan draft.
 *
 * The node map still comes from the static registry, and always will in this phase: nodes are
 * `if` statements in the orchestrator, not rows. What the database adds is the seven safe-config
 * values layered on top, plus whichever version is pending.
 *
 * `params` adalah Promise di Next.js 16 dan wajib di-await; membacanya sebagai objek biasa
 * lolos di editor tetapi gagal saat build.
 */
export async function GET(req: Request, { params }: { params: Promise<{ key: string }> }) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 })

  const { key } = await params
  const flow = getExistingFlow(key)
  if (!flow) return NextResponse.json({ error: 'Flow tidak ditemukan' }, { status: 404 })

  try {
    const definition = await prisma.botFlowDefinition.findUnique({
      where: { key },
      include: { versions: { orderBy: { version: 'desc' }, take: 10 } },
    })

    const versions = definition?.versions ?? []
    const published = versions.find((version) => version.status === 'PUBLISHED') ?? null
    const pending = versions.find((version) => ['DRAFT', 'REVIEW', 'APPROVED'].includes(version.status)) ?? null
    const editableLevel = definition?.editableLevel ?? 'READ_ONLY'

    return NextResponse.json({
      ...flow,
      // Not spread from the registry so it cannot be shadowed by a same-named field there.
      editableLevel,
      editableFields: editableFieldsFor(editableLevel),
      runtimeSource: definition?.runtimeSource ?? 'code',
      activeVersion: published
        ? {
            id: published.id,
            version: published.version,
            // Null when the stored shape is one this build cannot read — worth surfacing,
            // because it is exactly the config the runtime loader is also ignoring.
            config: readFlowSafeConfig(published.nodeConfig),
            publishedAt: published.publishedAt?.toISOString() ?? null,
            releaseId: published.releaseId,
          }
        : null,
      draftVersion: pending
        ? {
            id: pending.id,
            version: pending.version,
            status: pending.status,
            config: readFlowSafeConfig(pending.nodeConfig),
            changeReason: pending.changeReason,
          }
        : null,
      // Newest ten. A full history belongs on its own endpoint if it is ever wanted; shipping
      // every version's config in a detail response grows without bound.
      recentVersions: versions.map((version) => ({
        id: version.id,
        version: version.version,
        status: version.status,
        changeReason: version.changeReason,
        createdAt: version.createdAt.toISOString(),
      })),
    })
  } catch (error) {
    console.error('GET /api/bot-control/flows/[key] gagal', error)
    return NextResponse.json({ error: 'Gagal memuat detail flow' }, { status: 500 })
  }
}
