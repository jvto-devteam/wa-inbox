import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { SavedTestCases, type TestCaseRow } from './SavedTestCases'
import { fetchJson } from '@/lib/fetch-json'

vi.mock('@/lib/fetch-json', () => ({ fetchJson: vi.fn() }))

afterEach(cleanup)

function testCase(overrides: Partial<TestCaseRow> = {}): TestCaseRow {
  return {
    id: 'case_1',
    name: 'Harga ATV',
    description: null,
    category: 'Pricing',
    inputText: 'Berapa harga ATV?',
    expectedStatus: 'WOULD_REPLY',
    expectedContains: 'Rp',
    expectedNotContains: null,
    expectedHandoff: false,
    enabled: true,
    ...overrides,
  }
}

/** An empty but SHAPED run detail, so a test that runs the suite without stubbing the detail
 *  endpoint renders instead of crashing on `run.results.map`. */
const EMPTY_RUN = { id: 'run_1', status: 'PASSED', total: 0, passed: 0, failed: 0, skipped: 0, results: [] }

function stubList(items: TestCaseRow[]) {
  vi.mocked(fetchJson).mockImplementation(((url: string) => {
    if (url.startsWith('/api/bot-control/test-cases?')) {
      return Promise.resolve({ items, categories: ['Pricing'] })
    }
    if (url === '/api/bot-control/test-runs') return Promise.resolve({ testRunId: 'run_1' })
    if (url.startsWith('/api/bot-control/test-runs/')) return Promise.resolve(EMPTY_RUN)
    return Promise.resolve({})
  }) as unknown as typeof fetchJson)
}

beforeEach(() => {
  vi.clearAllMocks()
  stubList([testCase()])
})

describe('SavedTestCases', () => {
  it('lists the suite with its expectations spelled out', async () => {
    render(<SavedTestCases canRun />)
    await waitFor(() => expect(screen.getByText('Harga ATV')).toBeInTheDocument())
    expect(screen.getByText(/memuat "Rp"/)).toBeInTheDocument()
  })

  it('preselects every enabled case, so running the suite is one click', async () => {
    // Making an operator tick fifty boxes to do the common thing is how the suite stops being
    // run at all.
    stubList([testCase({ id: 'a' }), testCase({ id: 'b', enabled: false })])
    render(<SavedTestCases canRun />)

    await waitFor(() => expect(screen.getByRole('button', { name: /Jalankan 1 kasus/ })).toBeInTheDocument())
  })

  it('offers no controls to someone who may not run tests', async () => {
    render(<SavedTestCases canRun={false} />)
    await waitFor(() => expect(screen.getByText('Harga ATV')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /Jalankan/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Nonaktifkan' })).not.toBeInTheDocument()
  })

  it('says what to do when the suite is empty', async () => {
    stubList([])
    render(<SavedTestCases canRun />)
    await waitFor(() => expect(screen.getByText(/Belum ada kasus uji/)).toBeInTheDocument())
  })

  it('runs the selected cases and shows each failure verbatim', async () => {
    // The runner produces a readable sentence; hiding it behind a badge throws away the only
    // part that says what to fix.
    vi.mocked(fetchJson).mockImplementation(((url: string) => {
      if (url.startsWith('/api/bot-control/test-cases?')) {
        return Promise.resolve({ items: [testCase()], categories: ['Pricing'] })
      }
      if (url === '/api/bot-control/test-runs') return Promise.resolve({ testRunId: 'run_1' })
      return Promise.resolve({
        id: 'run_1',
        status: 'FAILED',
        total: 1,
        passed: 0,
        failed: 1,
        skipped: 0,
        results: [
          {
            id: 'res_1',
            testCaseId: 'case_1',
            testCaseName: 'Harga ATV',
            status: 'FAILED',
            inputText: 'Berapa harga ATV?',
            actualStatus: 'WOULD_HANDOFF',
            actualReply: null,
            failureReason: 'status WOULD_HANDOFF, diharapkan WOULD_REPLY',
            latencyMs: 200,
          },
        ],
      })
    }) as unknown as typeof fetchJson)

    render(<SavedTestCases canRun />)
    await waitFor(() => expect(screen.getByText('Harga ATV')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /Jalankan 1 kasus/ }))

    await waitFor(() =>
      expect(screen.getByText('status WOULD_HANDOFF, diharapkan WOULD_REPLY')).toBeInTheDocument()
    )
    expect(screen.getByText(/0 lulus/)).toBeInTheDocument()
  })

  it('runs as PRE_RELEASE, which is the scope the publish gate reads', async () => {
    render(<SavedTestCases canRun />)
    await waitFor(() => expect(screen.getByText('Harga ATV')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /Jalankan 1 kasus/ }))

    await waitFor(() => {
      const call = vi.mocked(fetchJson).mock.calls.find(([url]) => url === '/api/bot-control/test-runs')
      expect(call).toBeDefined()
      expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({ scope: 'PRE_RELEASE' })
    })
  })

  it('toggles a case without deleting it', async () => {
    render(<SavedTestCases canRun />)
    await waitFor(() => expect(screen.getByText('Harga ATV')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Nonaktifkan' }))

    await waitFor(() => {
      const call = vi.mocked(fetchJson).mock.calls.find(([url]) => url === '/api/bot-control/test-cases/case_1')
      expect(JSON.parse(String(call?.[1]?.body))).toEqual({ enabled: false })
    })
  })
})
