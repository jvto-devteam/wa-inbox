import { notFound } from 'next/navigation'
import { prisma } from '@/lib/db'
import { Badge } from '@/components/ui/badge'
import { ContactAvatar } from '@/components/ContactAvatar'
import { BookingSummary, type BookingData, type TripBrief } from '@/components/contacts/BookingSummary'
import { ensureFreshBookingData } from '@/lib/booking/client'
import { ContactLabels } from '@/components/contacts/ContactLabels'
import { ConsentSection } from '@/components/contacts/ConsentSection'
import { NotesSection } from '@/components/inbox/NotesSection'
import { RemindersSection } from '@/components/inbox/RemindersSection'
import { STAGE_LABELS, STAGE_VARIANTS } from '@/lib/pipeline'
import { displayMessageContent } from '@/lib/message-display'
import { PageHeader } from '@/components/ui/page-header'

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

  return (
    <main className="mx-auto w-full max-w-[1400px] space-y-5 p-6">
      <PageHeader
        backHref="/contacts"
        backLabel="Kembali ke Kontak"
        leading={<ContactAvatar name={contact.name} avatarUrl={contact.avatarUrl} size="size-10" />}
        title={contact.name ?? contact.phone}
        description={
          <>
            <span className="font-mono">{contact.phone}</span>
            {contact.source && ` · ${contact.source}`}
          </>
        }
        actions={
          <Badge variant={STAGE_VARIANTS[pipelineStage] ?? 'muted'}>
            {STAGE_LABELS[pipelineStage] ?? pipelineStage}
          </Badge>
        }
      />

      {/* Dua kolom mulai xl. Enam bagian yang ditumpuk vertikal di dalam satu kolom 768px
          membuat halaman ini sepanjang tiga layar padahal tidak ada satu pun bagian yang
          butuh lebar sebesar itu. Kiri: fakta kontak yang jarang berubah (booking, label,
          consent). Kanan: apa yang sedang berjalan (pengingat, catatan, riwayat pesan). */}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,28rem)_minmax(0,1fr)] xl:items-start">
        <div className="space-y-5">
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
            <section className="space-y-1">
              <h2 className="text-sm font-semibold text-ink">Label</h2>
              <p className="text-sm text-ink-muted">
                Label baru bisa dipasang setelah kontak ini mengirim pesan pertamanya.
              </p>
            </section>
          )}

          <ConsentSection contactId={contact.id} />
        </div>

        <div className="space-y-5">
          <RemindersSection contactId={contact.id} />

          <NotesSection contactId={contact.id} />

          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-ink">Riwayat pesan</h2>
            <div className="max-h-[32rem] overflow-y-auto overflow-x-hidden rounded-lg border border-line bg-surface">
              {messages.length === 0 ? (
                <p className="px-3 py-4 text-sm text-ink-muted">Belum ada pesan dengan kontak ini.</p>
              ) : (
                <ul>
                  {messages.map((m) => (
                    <li key={m.id} className="space-y-0.5 border-b border-line px-3 py-2 last:border-b-0">
                      {/* A logged bot handoff has content: null — rendering the raw `[${m.type}]`
                          fallback claimed the bot sent a text message when it never sent anything. */}
                      <p className="text-ink">{displayMessageContent(m)}</p>
                      <p className="text-xs text-ink-muted">
                        {m.direction === 'INBOUND' ? 'Masuk' : 'Keluar'} ·{' '}
                        <time dateTime={m.createdAt.toISOString()}>{formatMessageDate(m.createdAt)}</time>
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </div>
      </div>
    </main>
  )
}
