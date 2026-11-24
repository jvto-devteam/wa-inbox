import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth/get-session'
import { prisma } from '@/lib/db'
import { buildReport, type ReportRow } from '@/lib/new/report'

/**
 * GET /api/new/report?from=YYYY-MM-DD&to=YYYY-MM-DD — laporan inquiry WhatsApp → booking untuk
 * menu Laporan di /new. Baca saja; definisi angka ada di src/lib/new/report.ts.
 *
 * Satu kueri: per percakapan WhatsApp (bukan sandbox), pesan masuk pertama + beberapa kolom
 * bookingData yang dibutuhkan (bukan seluruh JSON-nya, yang memuat itinerary dan keuangan).
 * Percakapan WhatsApp lama bisa belum punya channelIdentity; yang bernomor dan bukan email
 * dihitung WhatsApp, sama dengan route /api/conversations/[id]/channel.
 */
const Q = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

type Raw = {
  id: string
  name: string | null
  phone: string | null
  stage: string
  first_in: Date
  booking_date: string | null
  booking_number: string | null
  package: string | null
  start_ymd: string | null
  order_channel: string | null
  kind: string | null
}

export async function GET(req: Request) {
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const parsed = Q.safeParse({ from: url.searchParams.get('from'), to: url.searchParams.get('to') })
  if (!parsed.success || parsed.data.from > parsed.data.to) {
    return NextResponse.json({ error: 'Parameter from/to wajib berformat YYYY-MM-DD dan from ≤ to' }, { status: 400 })
  }

  try {
    const raw = await prisma.$queryRaw<Raw[]>`
      select c.id, ct.name, ct.phone, c."pipelineStage" as stage,
        min(m."createdAt") as first_in,
        c."bookingData"->>'booking_date' as booking_date,
        c."bookingData"->>'booking_number' as booking_number,
        c."bookingData"->>'package' as package,
        c."bookingData"->'date'->>'start_ymd' as start_ymd,
        c."bookingData"->>'orderChannel' as order_channel,
        c."chatReview"->>'jenisKontak' as kind
      from "Conversation" c
      join "Contact" ct on ct.id = c."contactId"
      left join "ChannelIdentity" ci on ci.id = c."channelIdentityId"
      join "Message" m on m."conversationId" = c.id and m.direction = 'INBOUND'
      where c."isTest" = false
        and (ci.platform = 'WHATSAPP'
          or (c."channelIdentityId" is null and c."mailAccountId" is null and ct.phone is not null))
      group by c.id, ct.id`

    const rows: ReportRow[] = raw.map((r) => ({
      id: r.id,
      name: r.name,
      phone: r.phone,
      stage: r.stage,
      firstIn: new Date(r.first_in),
      bookingDate: r.booking_date,
      bookingNumber: r.booking_number,
      pkg: r.package,
      startYmd: r.start_ymd,
      orderChannel: r.order_channel,
      kind: r.kind,
    }))
    return NextResponse.json(buildReport(rows, parsed.data.from, parsed.data.to))
  } catch (error) {
    console.error('GET /api/new/report gagal', { error })
    return NextResponse.json({ error: 'Gagal membuat laporan' }, { status: 500 })
  }
}
