import { metaFetch } from './client'

export type ConversationCategory = 'MARKETING' | 'UTILITY' | 'AUTHENTICATION' | 'SERVICE'

export type ConversationCostDataPoint = {
  start: number
  end: number
  conversationCategory: ConversationCategory | null
  conversationCount: number
  cost: number
}

type RawDataPoint = {
  start: number
  end: number
  conversation: number
  cost?: number
  conversation_category?: ConversationCategory
}

type RawResponse = {
  currency?: string
  conversation_analytics?: { data?: Array<{ data_points?: RawDataPoint[] }> }
}

export type ConversationCostReport = { currency: string | null; dataPoints: ConversationCostDataPoint[] }

/**
 * Meta's Conversation Analytics API (the `conversation_analytics` edge on the WABA node) --
 * the only piece of WhatsApp billing data actually reachable via the Graph API. There is no
 * corresponding endpoint for the WABA's payment-method wallet/threshold balance itself; that
 * only ever shows in Meta Business Manager's own billing UI, never via API, for any WABA.
 */
export async function getConversationCosts(
  waNumber: { wabaId: string; accessToken: string },
  { startUnix, endUnix }: { startUnix: number; endUnix: number }
): Promise<ConversationCostReport> {
  const fields =
    `currency,conversation_analytics` +
    `.start(${startUnix}).end(${endUnix}).granularity(DAILY)` +
    `.dimensions(["CONVERSATION_CATEGORY"])`
  const query = new URLSearchParams({ fields }).toString()
  const body = (await metaFetch(`/${waNumber.wabaId}?${query}`, waNumber.accessToken)) as RawResponse

  const dataPoints = (body.conversation_analytics?.data ?? []).flatMap((d) => d.data_points ?? []).map((p) => ({
    start: p.start,
    end: p.end,
    conversationCategory: p.conversation_category ?? null,
    conversationCount: p.conversation,
    cost: p.cost ?? 0,
  }))

  return { currency: body.currency ?? null, dataPoints }
}
