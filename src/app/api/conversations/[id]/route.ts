import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const conversation = await prisma.conversation.findUniqueOrThrow({
    where: { id },
    include: { contact: true, labels: { include: { label: true } } },
  })
  return NextResponse.json({
    botEnabled: conversation.botEnabled,
    contactName: conversation.contact.name,
    avatarUrl: conversation.contact.avatarUrl,
    source: conversation.contact.source,
    bookingData: conversation.bookingData,
    tripBrief: conversation.tripBrief,
    labels: conversation.labels.map((l) => ({ id: l.label.id, name: l.label.name, color: l.label.color })),
  })
}
