import { z } from 'zod'
import { RESOLVER_TOPICS, type ResolverTopic } from '@/lib/bot/module-resolver'
import type { SalesClassification } from '@/lib/bot/types'

export type TopicLabelSource = 'auto' | 'manual'

export type TopicLabels = {
  topic: ResolverTopic
  alsoTopics: ResolverTopic[]
  job: SalesClassification['job']
  topicSource: 'llm' | 'regex_fallback'
  source: TopicLabelSource
  at: string
}

export const topicLabelsSchema = z.object({
  topic: z.enum(RESOLVER_TOPICS),
  alsoTopics: z.array(z.enum(RESOLVER_TOPICS)),
  job: z.enum(['J1', 'J2', 'J3', 'J4', 'J5']),
  topicSource: z.enum(['llm', 'regex_fallback']),
  source: z.enum(['auto', 'manual']),
  at: z.string(),
})

/** Kolom Json dibaca defensif: bentuk yang tidak dikenal build ini dianggap belum berlabel. */
export function readTopicLabels(value: unknown): TopicLabels | null {
  const parsed = topicLabelsSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}
