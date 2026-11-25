import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth/get-session'
import { prisma } from '@/lib/db'
import { jakartaDay } from '@/lib/bot/eval/replay-pairs'
import { buildReport, type ReportRow } from '@/lib/new/report'
import { tripEndDay, tripStartDay } from '@/lib/summary-items/exclusion'

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
  contact_id: string
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
  blocker: unknown
  next_step: string | null
  review_at: Date | null
  last_at: Date | null
  last_dir: 'INBOUND' | 'OUTBOUND' | null
  created_at: Date
  trip_start: string | null
  trip_end: string | null
  profile: unknown
  awaiting_guest: boolean | null
  awaiting_reply: boolean
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
      select c.id, ct.id as contact_id, ct.name, ct.phone, c."pipelineStage" as stage,
        min(m."createdAt") as first_in,
        c."bookingData"->>'booking_date' as booking_date,
        c."bookingData"->>'booking_number' as booking_number,
        c."bookingData"->>'package' as package,
        c."bookingData"->'date'->>'start_ymd' as start_ymd,
        c."bookingData"->>'orderChannel' as order_channel,
        c."chatReview"->>'jenisKontak' as kind,
        c."chatReview"->'belumBooking' as blocker,
        c."chatReview"->>'langkahBerikut' as next_step,
        c."chatReviewAt" as review_at,
        c."createdAt" as created_at,
        c."chatReview"->>'tanggalTripMulai' as trip_start,
        c."chatReview"->>'tanggalTripSelesai' as trip_end,
        c."chatReview"->'profil' as profile,
        case when jsonb_typeof(c."chatReview"->'menungguTamu') = 'boolean' then (c."chatReview"->>'menungguTamu')::boolean end as awaiting_guest,
        exists (select 1 from "SummaryItem" si where si."conversationId" = c.id and si.kind = 'REPLY' and si.state in ('OPEN', 'SCHEDULED')) as awaiting_reply,
        last.created_at as last_at,
        last.direction::text as last_dir
      from "Conversation" c
      join "Contact" ct on ct.id = c."contactId"
      left join "ChannelIdentity" ci on ci.id = c."channelIdentityId"
      join "Message" m on m."conversationId" = c.id and m.direction = 'INBOUND'
      left join lateral (
        select lm."createdAt" as created_at, lm.direction
        from "Message" lm where lm."conversationId" = c.id
        order by lm."createdAt" desc limit 1
      ) last on true
      where c."isTest" = false
        and (ci.platform = 'WHATSAPP'
          or (c."channelIdentityId" is null and c."mailAccountId" is null and ct.phone is not null))
      group by c.id, ct.id, last.created_at, last.direction`

    const rows: ReportRow[] = raw.map((r) => ({
      id: r.id,
      contactId: r.contact_id,
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
      blocker: r.blocker,
      nextStep: r.next_step,
      reviewAt: r.review_at ? new Date(r.review_at) : null,
      lastAt: r.last_at ? new Date(r.last_at) : null,
      lastDir: r.last_dir,
      // Tanggal trip mintaan, tahunnya dibetulkan sama dengan Antrean (AQ-24); hari mulai dulu, tanpa itu hari selesai.
      leadTripDay: (() => {
        const review = { tanggalTripMulai: r.trip_start, tanggalTripSelesai: r.trip_end }
        const createdAt = new Date(r.created_at)
        return tripStartDay(review, createdAt) ?? tripEndDay(review, createdAt)
      })(),
      profile: r.profile,
      awaitingGuest: r.awaiting_guest,
      awaitingReply: r.awaiting_reply === true,
    }))
    const today = jakartaDay(new Date())
    return NextResponse.json(buildReport(rows, parsed.data.from, parsed.data.to, 8, today))
  } catch (error) {
    console.error('GET /api/new/report gagal', { error })
    return NextResponse.json({ error: 'Gagal membuat laporan' }, { status: 500 })
  }
}
