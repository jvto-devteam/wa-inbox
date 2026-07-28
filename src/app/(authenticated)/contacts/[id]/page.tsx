import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/db'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { BookingSummary, type BookingData, type TripBrief } from '@/components/contacts/BookingSummary'
import { ensureFreshBookingData } from '@/lib/booking/client'
import { ContactLabels } from '@/components/contacts/ContactLabels'
import { NotesSection } from '@/components/inbox/NotesSection'
import { RemindersSection } from '@/components/inbox/RemindersSection'
import { STAGE_LABELS, STAGE_VARIANTS } from '@/lib/pipeline'
import { displayMessageContent } from '@/lib/message-display'

function formatMessageDate(date: Date) {
  return date.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })
}

export default async function ContactDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const contact = await prisma.contact.findUnique({
    where: { id },
    include: {
      conversation: {
        include: {
          labels: { include: { label: true } },
          messages: { orderBy: { createdAt: 'asc' } },
        },
      },
    },
  })

  if (!contact) notFound()

  const conversation = contact.conversation
  // Same reasoning as the /api/conversations/[id] route: refresh on open, independent of
  // whether the bot ever ran for this conversation (e.g. while the kill switch is on).
  const bookingData = conversation ? await ensureFreshBookingData({ ...conversation, contact }) : null
  const allLabels = await prisma.label.findMany()
  const attachedLabels = conversation?.labels.map((l) => l.label) ?? []
  const pipelineStage = conversation?.pipelineStage ?? 'new'
  const messages = conversation?.messages ?? []
  const initial = (contact.name ?? '?').trim().charAt(0).toUpperCase()

  return (
    <main className="mx-auto max-w-3xl space-y-4 p-6">
      <Link href="/contacts" className="text-sm text-brand hover:underline">
        &larr; Kembali ke Kontak
      </Link>

      <div className="flex items-center gap-3">
        {contact.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={contact.avatarUrl} alt={contact.name ?? 'Kontak'} className="size-12 rounded-full object-cover" />
        ) : (
          <div className="flex size-12 items-center justify-center rounded-full bg-navy text-base font-medium text-white">
            {initial}
          </div>
        )}
        <div>
          <h1 className="text-xl font-semibold text-navy">{contact.name ?? contact.phone}</h1>
          <p className="text-sm text-muted-foreground">
            {contact.phone}
            {contact.source && ` · ${contact.source}`}
          </p>
        </div>
        <Badge variant={STAGE_VARIANTS[pipelineStage] ?? 'muted'} className="ml-auto">
          {STAGE_LABELS[pipelineStage] ?? pipelineStage}
        </Badge>
      </div>

      <BookingSummary
        bookingData={(bookingData as unknown as BookingData | null) ?? null}
        tripBrief={(conversation?.tripBrief as unknown as TripBrief) ?? null}
      />

      {conversation ? (
        <ContactLabels
          conversationId={conversation.id}
          allLabels={allLabels}
          initialLabels={attachedLabels}
        />
      ) : (
        <div className="space-y-2">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Label</h3>
          <p className="text-sm text-muted-foreground">Percakapan belum dibuat untuk kontak ini.</p>
        </div>
      )}

      <RemindersSection contactId={contact.id} />

      <NotesSection contactId={contact.id} />

      <div className="space-y-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Riwayat Pesan</h3>
        <Card className="max-h-96 space-y-2 overflow-y-auto p-3">
          {messages.length === 0 ? (
            <p className="text-sm text-muted-foreground">Belum ada pesan.</p>
          ) : (
            <ul className="space-y-2">
              {messages.map((m) => (
                <li key={m.id} className="space-y-0.5 border-b border-border pb-2 last:border-0 last:pb-0">
                  {/* A logged bot handoff has content: null — rendering the raw `[${m.type}]`
                      fallback claimed the bot sent a text message when it never sent anything. */}
                  <p className="text-sm text-navy">{displayMessageContent(m)}</p>
                  <p className="text-xs text-muted-foreground">
                    {m.direction === 'INBOUND' ? 'Masuk' : 'Keluar'} · {formatMessageDate(m.createdAt)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </main>
  )
}
