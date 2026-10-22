import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { ensureFreshBookingData } from '@/lib/booking/client'
import { noteChatOpenedForChatReview } from '@/lib/chat-review/auto-refresh'
import { canUseDryRun } from '@/lib/booking-actions/rollout'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const conversation = await prisma.conversation.findUniqueOrThrow({
    where: { id },
    include: { contact: true, labels: { include: { label: true } }, channelIdentity: { select: { platform: true } } },
  })
  // Refreshed here (not just as a side effect of the bot answering a message) so
  // ContactPanel shows real booking data as soon as an agent opens the conversation,
  // independent of whether the bot ever actually ran for it -- e.g. while the kill
  // switch is on, which stops the bot but has no bearing on whether this customer
  // has a real booking on file.
  const bookingData = await ensureFreshBookingData(conversation)
  // Owner 2026-10-22: membuka chat memeriksa apakah ada pesan sesudah ringkasan terakhir; bila ada, ringkasan baru
  // dijadwalkan (tidak ditunggu, gerbang & jeda 5 menit sama dengan pemicu pesan).
  noteChatOpenedForChatReview(id)
  return NextResponse.json({
    botEnabled: conversation.botEnabled,
    isTest: conversation.isTest,
    dryRun: conversation.dryRun,
    canDryRun: canUseDryRun(conversation),
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
    platform: conversation.channelIdentity?.platform ?? null,
    subject: conversation.subject,
  })
}
