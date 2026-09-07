import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth/get-session'
import { parseJsonBody } from '@/lib/parse-json'
import {
  upsertTriage,
  DecisionNotFoundError,
  TriageForbiddenError,
  TRIAGE_ISSUE_TYPES,
  TRIAGE_SEVERITIES,
  TRIAGE_STATUSES,
} from '@/lib/bot-control/triage'

/**
 * POST  /api/bot-control/decisions/[id]/triage — open a triage, or update the one that exists.
 * PATCH /api/bot-control/decisions/[id]/triage — the same operation, for callers who read
 *       "update" as PATCH.
 *
 * Both verbs are the same upsert, deliberately. `decisionRunId` is unique, so there is only ever
 * one triage per decision, and asking a client to know whether one exists before choosing a verb
 * would just move a race condition into the browser.
 *
 * Open to any signed-in user; the narrower rules — assign only to yourself, admin-only to close
 * — live in triage.ts and apply to both verbs.
 */
const bodySchema = z
  .object({
    status: z.enum(TRIAGE_STATUSES as unknown as [string, ...string[]]).optional(),
    issueType: z.enum(TRIAGE_ISSUE_TYPES as unknown as [string, ...string[]]).nullable().optional(),
    severity: z.enum(TRIAGE_SEVERITIES as unknown as [string, ...string[]]).optional(),
    assignedTo: z.string().min(1).nullable().optional(),
    note: z.string().trim().max(2000).nullable().optional(),
    linkedEntityType: z.string().trim().max(60).nullable().optional(),
    linkedEntityId: z.string().trim().max(200).nullable().optional(),
  })
  .strict()

async function handle(req: Request, params: Promise<{ id: string }>) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 })

  const { id } = await params
  const parsed = await parseJsonBody(req, bodySchema, 'Data tindak lanjut tidak valid')
  if (!parsed.success) return NextResponse.json({ error: parsed.error }, { status: 400 })

  try {
    const actor = await prisma.account.findUnique({ where: { id: session.accountId }, select: { name: true } })
    const triage = await upsertTriage(
      id,
      parsed.data as Parameters<typeof upsertTriage>[1],
      { id: session.accountId, name: actor?.name ?? null, isAdmin: session.role === 'ADMIN' },
      req
    )

    return NextResponse.json(serializeTriage(triage))
  } catch (error) {
    if (error instanceof DecisionNotFoundError) return NextResponse.json({ error: error.message }, { status: 404 })
    // 403: the request is well-formed, the ROLE is what is refusing.
    if (error instanceof TriageForbiddenError) return NextResponse.json({ error: error.message }, { status: 403 })
    console.error('POST /api/bot-control/decisions/[id]/triage gagal', error)
    return NextResponse.json({ error: 'Gagal menyimpan tindak lanjut' }, { status: 500 })
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(req, params)
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(req, params)
}

/** GET the triage for one decision, or null when nobody has filed one. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 })

  const { id } = await params

  try {
    const triage = await prisma.botDecisionTriage.findUnique({ where: { decisionRunId: id } })
    // Null rather than 404: "no triage yet" is the normal state of almost every decision, and
    // making the client treat it as an error would fill the console with expected failures.
    return NextResponse.json({ triage: triage ? serializeTriage(triage) : null })
  } catch (error) {
    console.error('GET /api/bot-control/decisions/[id]/triage gagal', error)
    return NextResponse.json({ error: 'Gagal memuat tindak lanjut' }, { status: 500 })
  }
}

type TriageRow = {
  id: string
  decisionRunId: string
  status: string
  issueType: string | null
  severity: string
  assignedTo: string | null
  note: string | null
  linkedEntityType: string | null
  linkedEntityId: string | null
  resolvedBy: string | null
  resolvedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export function serializeTriage(row: TriageRow) {
  return {
    id: row.id,
    decisionRunId: row.decisionRunId,
    status: row.status,
    issueType: row.issueType,
    severity: row.severity,
    assignedTo: row.assignedTo,
    note: row.note,
    linkedEntityType: row.linkedEntityType,
    linkedEntityId: row.linkedEntityId,
    resolvedBy: row.resolvedBy,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}
