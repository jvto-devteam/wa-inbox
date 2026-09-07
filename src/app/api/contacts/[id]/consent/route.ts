import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { getSession } from '@/lib/auth/get-session'
import { parseJsonBody } from '@/lib/parse-json'

/**
 * Read and set a contact's marketing consent.
 *
 * `ContactConsent` shipped as a model, a migration and an index, with the outbound safety guard
 * reading it on every queued send — and NOTHING anywhere ever wrote a row. The opt-out branch in
 * safety-guard.ts was therefore unreachable by construction: the table could only ever be empty.
 * This is the writer that makes it real.
 *
 * A MISSING row means "never asked", not "opted out". That is how every existing contact looks,
 * so the guard treats absence as allowed and this route only ever creates a row when a human
 * actually records a decision.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 })

  const { id } = await params
  const consent = await prisma.contactConsent.findUnique({ where: { contactId: id } })

  // Null, not a fabricated default: "nobody has recorded a decision" is a different fact from
  // "this contact opted in", and the UI says so.
  return NextResponse.json({
    consent: consent
      ? {
          optOut: consent.optOut,
          source: consent.source,
          note: consent.note,
          updatedAt: consent.updatedAt.toISOString(),
        }
      : null,
  })
}

const bodySchema = z
  .object({
    optOut: z.boolean(),
    // Free text, because the reason a customer opted out is rarely one of a fixed set, and an
    // opt-out with no recorded reason is the one an operator later cannot defend.
    note: z.string().trim().max(500).optional(),
  })
  .strict()

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 })

  const { id } = await params
  const parsed = await parseJsonBody(req, bodySchema, 'Data consent tidak valid')
  if (!parsed.success) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const contact = await prisma.contact.findUnique({ where: { id }, select: { id: true } })
  if (!contact) return NextResponse.json({ error: 'Kontak tidak ditemukan' }, { status: 404 })

  try {
    // `optIn` is kept as the mirror of `optOut` rather than a second independent switch: the
    // guard reads either as opt-out (`optOut === true || optIn === false`), so letting the two
    // disagree would make the block depend on which field happened to be written last.
    const consent = await prisma.contactConsent.upsert({
      where: { contactId: id },
      create: {
        contactId: id,
        optOut: parsed.data.optOut,
        optIn: !parsed.data.optOut,
        source: 'AGENT',
        note: parsed.data.note ?? null,
        updatedBy: session.accountId,
      },
      update: {
        optOut: parsed.data.optOut,
        optIn: !parsed.data.optOut,
        source: 'AGENT',
        note: parsed.data.note ?? null,
        updatedBy: session.accountId,
      },
    })

    return NextResponse.json({
      consent: {
        optOut: consent.optOut,
        source: consent.source,
        note: consent.note,
        updatedAt: consent.updatedAt.toISOString(),
      },
    })
  } catch (error) {
    console.error('PUT /api/contacts/[id]/consent gagal', error)
    return NextResponse.json({ error: 'Gagal menyimpan consent' }, { status: 500 })
  }
}
