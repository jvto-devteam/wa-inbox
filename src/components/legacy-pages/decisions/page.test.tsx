import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import DecisionLogsPage from './page'

/**
 * Cover for item b4: the separate triage table became two columns on BotDecisionRun.
 *
 * Two things this page used to do are now defects, and the endpoint allowlist below turns
 * either of them back into a test failure:
 *
 *   1. A SECOND request, to the separate follow-up listing, on every filter change — including
 *      changes to a filter that was applied in the browser anyway. Its 200-row cap also meant
 *      the badge for a decision on page 5 simply never appeared.
 *   2. Filtering "hanya yang ditandai" client-side over a 50-row page, which hid every flagged
 *      decision that happened to sit on another page.
 */

let calls: Array<{ url: string; init?: RequestInit }> = []

/**
 * Every request this page is allowed to make: the ONE list query, and a flag toggle on a
 * single decision. Deliberately exact rather than a path prefix — a prefix would still admit
 * the second listing this item removed, which is the thing being guarded against.
 */
const ALLOWED = [/^\/api\/bot-control\/decisions\?/, /^\/api\/bot-control\/decisions\/[^/]+\/flag$/]
const isAllowed = (url: string) => ALLOWED.some((pattern) => pattern.test(url))

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'run_1',
    conversationId: 'conv_1',
    contactName: 'Bruno Figarola',
    contactPhone: '6281234567890',
    mode: 'faq',
    status: 'REPLIED',
    inboundPreview: 'berapa harga ijen 3d2n?',
    latencyMs: 2500,
    knowledgeRefsCount: 1,
    hasVerification: false,
    error: null,
    startedAt: '2026-09-05T03:00:00.000Z',
    flaggedAt: null,
    flagNote: null,
    ...overrides,
  }
}

function mockFetch(items: Record<string, unknown>[] = [row()]) {
  calls = []
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url, init })

      if (!isAllowed(url)) {
        return Promise.resolve({ ok: false, status: 404, json: async () => ({ error: `Endpoint terlarang: ${url}` }) })
      }
      if (url.startsWith('/api/bot-control/decisions?')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ items, page: 1, limit: 50, total: items.length }),
        })
      }
      if (url.endsWith('/flag') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as { flagged: boolean; note?: string | null }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            id: 'run_1',
            flaggedAt: body.flagged ? '2026-09-08T02:00:00.000Z' : null,
            flagNote: body.flagged ? body.note ?? null : null,
          }),
        })
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) })
    })
  )
}

const listCalls = () => calls.filter((c) => c.url.startsWith('/api/bot-control/decisions?'))
const flagCalls = () => calls.filter((c) => c.url.endsWith('/flag'))

beforeEach(() => {
  vi.clearAllMocks()
  mockFetch()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('Decision Logs page — flagging', () => {
  it('never calls a second triage endpoint, on load or on any filter change', async () => {
    render(<DecisionLogsPage />)
    await screen.findByText('berapa harga ijen 3d2n?')

    fireEvent.change(screen.getByLabelText('Filter status'), { target: { value: 'HANDOFF' } })
    fireEvent.change(screen.getByLabelText('Filter tanda'), { target: { value: 'true' } })
    await waitFor(() => expect(listCalls().length).toBeGreaterThan(1))

    // The whole point of the two columns: one list query answers both questions. Any request
    // to a second listing — or to anything else at all — fails here.
    expect(calls.map((c) => c.url).filter((url) => !isAllowed(url))).toEqual([])
  })

  it('sends "hanya yang ditandai" to the server as a query param', async () => {
    render(<DecisionLogsPage />)
    await screen.findByText('berapa harga ijen 3d2n?')

    fireEvent.change(screen.getByLabelText('Filter tanda'), { target: { value: 'true' } })

    await waitFor(() => expect(listCalls().some((c) => c.url.includes('flagged=true'))).toBe(true))
    // Back to "Semua keputusan" drops the param rather than filtering the response in the browser.
    fireEvent.change(screen.getByLabelText('Filter tanda'), { target: { value: '' } })
    await waitFor(() => expect(listCalls().at(-1)?.url.includes('flagged=true')).toBe(false))
  })

  it('marks a decision, sending the note the operator typed', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue('Harga ATV salah')
    render(<DecisionLogsPage />)
    await screen.findByText('berapa harga ijen 3d2n?')

    fireEvent.click(screen.getByRole('button', { name: 'Tandai perlu diperbaiki' }))

    await waitFor(() => expect(flagCalls()).toHaveLength(1))
    expect(JSON.parse(String(flagCalls()[0].init?.body))).toEqual({ flagged: true, note: 'Harga ATV salah' })
    // The row updates in place — no refetch that would make it vanish under an active filter.
    expect(await screen.findByText('Perlu diperbaiki')).toBeTruthy()
    expect(screen.getByText('Harga ATV salah')).toBeTruthy()
    expect(listCalls()).toHaveLength(1)
  })

  it('cancelling the note prompt files nothing at all', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue(null)
    render(<DecisionLogsPage />)
    await screen.findByText('berapa harga ijen 3d2n?')

    fireEvent.click(screen.getByRole('button', { name: 'Tandai perlu diperbaiki' }))
    await waitFor(() => expect(flagCalls()).toHaveLength(0))
  })

  it('unmarks an already-flagged decision without asking for a note', async () => {
    const prompt = vi.spyOn(window, 'prompt').mockReturnValue('')
    mockFetch([row({ flaggedAt: '2026-09-08T02:00:00.000Z', flagNote: 'Harga ATV salah' })])

    render(<DecisionLogsPage />)
    await screen.findByText('Perlu diperbaiki')

    fireEvent.click(screen.getByRole('button', { name: 'Batalkan tanda' }))

    await waitFor(() => expect(flagCalls()).toHaveLength(1))
    expect(JSON.parse(String(flagCalls()[0].init?.body))).toEqual({ flagged: false, note: null })
    expect(prompt).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByText('Perlu diperbaiki')).toBeNull())
  })
})
