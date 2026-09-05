import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getConversationCosts } from './analytics'

import type { MockedFunction } from 'vitest'

// `fetch` is re-stubbed on every beforeEach, so the handle is resolved lazily instead of
// bound once at module scope -- binding it once would keep pointing at the previous test's
// stub. The stubbed value stays loose because these tests hand fetch deliberately partial
// Response fixtures (ok + json only); the call tuple gets its real shape back at the point
// of inspection instead, which is where the types actually earn something.
const mockFetch = () => fetch as unknown as MockedFunction<(...args: never[]) => unknown>
type FetchInit = { method?: string; body: string; signal?: AbortSignal | null; headers: Record<string, string | undefined> }
const fetchCall = (index = 0) => mockFetch().mock.calls[index] as unknown as [string, FetchInit]

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})

describe('getConversationCosts', () => {
  it('requests the conversation_analytics edge on the WABA node with the given date range', async () => {
    ;mockFetch().mockResolvedValue({ ok: true, json: async () => ({ currency: 'USD', conversation_analytics: { data: [] } }) })

    await getConversationCosts({ wabaId: 'waba_1', accessToken: 'tok' }, { startUnix: 1000, endUnix: 2000 })

    const [url, options] = fetchCall(0)
    expect(url).toContain('https://graph.facebook.com/v20.0/waba_1?fields=')
    expect(decodeURIComponent(url)).toContain('conversation_analytics.start(1000).end(2000).granularity(DAILY)')
    expect(decodeURIComponent(url)).toContain('dimensions(["CONVERSATION_CATEGORY"])')
    expect(options.headers.Authorization).toBe('Bearer tok')
  })

  it('flattens data_points across every returned series into a single list', async () => {
    ;mockFetch().mockResolvedValue({
      ok: true,
      json: async () => ({
        currency: 'USD',
        conversation_analytics: {
          data: [
            {
              data_points: [
                { start: 1000, end: 1086400, conversation: 3, cost: 1.5, conversation_category: 'MARKETING' },
                { start: 1000, end: 1086400, conversation: 5, cost: 0.4, conversation_category: 'SERVICE' },
              ],
            },
          ],
        },
      }),
    })

    const result = await getConversationCosts({ wabaId: 'waba_1', accessToken: 'tok' }, { startUnix: 1000, endUnix: 2000 })

    expect(result.currency).toBe('USD')
    expect(result.dataPoints).toEqual([
      { start: 1000, end: 1086400, conversationCategory: 'MARKETING', conversationCount: 3, cost: 1.5 },
      { start: 1000, end: 1086400, conversationCategory: 'SERVICE', conversationCount: 5, cost: 0.4 },
    ])
  })

  it('returns an empty list and null currency when Meta reports no analytics at all', async () => {
    ;mockFetch().mockResolvedValue({ ok: true, json: async () => ({}) })

    const result = await getConversationCosts({ wabaId: 'waba_1', accessToken: 'tok' }, { startUnix: 1000, endUnix: 2000 })

    expect(result).toEqual({ currency: null, dataPoints: [] })
  })

  it('defaults a missing cost on a data point to 0 rather than NaN/undefined', async () => {
    ;mockFetch().mockResolvedValue({
      ok: true,
      json: async () => ({
        conversation_analytics: { data: [{ data_points: [{ start: 1000, end: 1086400, conversation: 2, conversation_category: 'UTILITY' }] }] },
      }),
    })

    const result = await getConversationCosts({ wabaId: 'waba_1', accessToken: 'tok' }, { startUnix: 1000, endUnix: 2000 })

    expect(result.dataPoints[0].cost).toBe(0)
  })
})
