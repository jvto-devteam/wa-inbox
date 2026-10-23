import { reportAiActivity } from '@/lib/ai-office/activity'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { broadcast } from '@/lib/realtime'
import { withMediaUrl } from '@/lib/serialize-message'
import { classifyTopicViaLLM } from '@/lib/bot/topic-classifier'
import { classifyAllTopics } from '@/lib/bot/multi-topic-classifier'
import { classifySalesNeed } from '@/lib/bot/sales-classifier'
import type { TopicLabels, TopicLabelSource } from './topic-labels-schema'

export type { TopicLabels, TopicLabelSource } from './topic-labels-schema'

/**
 * Label topik & intent satu pesan INBOUND berteks: disimpan ke Message.topicLabels lalu
 * dipancarkan sebagai message.updated. Tidak pernah melempar -- jalur ingest memanggilnya tanpa
 * menunggu, dan kegagalannya hanya berarti pesan itu tanpa label ("Cek topik" tetap ada).
 * Teks pesan sengaja tidak masuk log.
 */
export async function classifyAndStoreTopicLabels(
  messageId: string,
  source: TopicLabelSource
): Promise<TopicLabels | null> {
  let conversationId: string | null = null
  try {
    const message = await prisma.message.findUnique({
      where: { id: messageId },
      select: { direction: true, content: true, conversationId: true },
    })
    const text = message?.content?.trim()
    if (!message || message.direction !== 'INBOUND' || !text) return null
    conversationId = message.conversationId ?? null
    if (conversationId) reportAiActivity('topik', 'mulai', 'Memberi label topik pesan', conversationId)

    const settings = await prisma.settings.findUnique({ where: { id: 1 }, select: { ollamaModel: true } })
    const model = settings?.ollamaModel
    const [primary, all] = await Promise.all([classifyTopicViaLLM(null, text, model), classifyAllTopics(text, model)])

    const labels: TopicLabels = {
      topic: primary.topic,
      alsoTopics: all.filter((topic) => topic !== primary.topic),
      job: classifySalesNeed({ message: text, tripBrief: {} }).job,
      topicSource: primary.source,
      source,
      at: new Date().toISOString(),
    }

    const updated = await prisma.message.update({
      where: { id: messageId },
      data: { topicLabels: labels as unknown as Prisma.InputJsonValue },
      include: { replyTo: true },
    })
    broadcast({ type: 'message.updated', conversationId: updated.conversationId, message: withMediaUrl(updated) })
    reportAiActivity('topik', 'selesai', `Label: ${labels.topic}`, updated.conversationId)
    return labels
  } catch (error) {
    console.error('classifyAndStoreTopicLabels gagal', { messageId, source, error })
    if (conversationId) reportAiActivity('topik', 'gagal', 'Gagal memberi label', conversationId)
    return null
  }
}
