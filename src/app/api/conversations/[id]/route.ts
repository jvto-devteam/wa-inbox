import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { ensureFreshBookingData } from '@/lib/booking/client'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const conversation = await prisma.conversation.findUniqueOrThrow({
    where: { id },
    include: { contact: true, labels: { include: { label: true } } },
  })
  // Refreshed here (not just as a side effect of the bot answering a message) so
  // ContactPanel shows real booking data as soon as an agent opens the conversation,
  // independent of whether the bot ever actually ran for it -- e.g. while the kill
  // switch is on, which stops the bot but has no bearing on whether this customer
  // has a real booking on file.
  const bookingData = await ensureFreshBookingData(conversation)
  return NextResponse.json({
    botEnabled: conversation.botEnabled,
    contactId: conversation.contact.id,
    contactName: conversation.contact.name,
    avatarUrl: conversation.contact.avatarUrl,
    source: conversation.contact.source,
    bookingData,
    tripBrief: conversation.tripBrief,
    labels: conversation.labels.map((l) => ({ id: l.label.id, name: l.label.name, color: l.label.color })),
    pipelineStage: conversation.pipelineStage,
    assignedAgentId: conversation.assignedAgentId,
    lastReadAt: conversation.lastReadAt?.toISOString() ?? null,
  })
}
