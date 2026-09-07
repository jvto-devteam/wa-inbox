import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import ReleasesPage from './page'

/**
 * Regression cover for the audit finding "Tombol Publish di UI Releases tidak pernah bisa
 * berhasil karena tidak mengirim testRunId".
 *
 * The page used to POST `{ title, description }` and nothing else, while `assertTestGate` in
 * src/lib/bot-control/release.ts refuses any publish that names no passing run. Every press of
 * the button was therefore a guaranteed 409, and the whole draft -> approve -> publish loop
 * could only be completed with curl.
 *
 * The stub below deliberately behaves like the real gate rather than accepting anything, so
 * these tests fail if the body ever loses `testRunId` again.
 */

const PASSED_RUN = {
  id: 'run_pass',
  name: 'Suite pra-release',
  scope: 'PRE_RELEASE',
  status: 'PASSED',
  total: 12,
  passed: 12,
  failed: 0,
  finishedAt: '2026-09-07T02:00:00.000Z',
}

let calls: Array<{ url: string; init?: RequestInit }> = []

const PREVIEW = {
  changes: { rules: 1, knowledge: 0, flows: 1, channelPolicy: 0 },
  requiresTestRun: true,
  blockingIssues: [],
  candidate: { ruleDraftKeys: ['bot.skip_indonesian_numbers'], knowledgeRevisionIds: [], flowVersionIds: ['ver_9'] },
}

type Opts = {
  role?: string
  runs?: (typeof PASSED_RUN)[]
  cases?: Array<{ id: string }>
  runStatus?: string
}

/** Mirrors assertTestGate: a publish naming no run (and not overriding) is a 409, not a 200. */
function mockFetch(opts: Opts = {}) {
  calls = []
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url, init })

      if (url.startsWith('/api/session')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ role: opts.role ?? 'ADMIN' }) })
      }
      if (url === '/api/bot-control/test-runs' && init?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ testRunId: PASSED_RUN.id, status: opts.runStatus ?? 'PASSED', failed: 0, total: 12 }),
        })
      }
      if (url.startsWith('/api/bot-control/test-runs')) {
        const items = opts.runs ?? [PASSED_RUN]
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ items, page: 1, limit: 20, total: items.length }) })
      }
      if (url.startsWith('/api/bot-control/test-cases')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ items: opts.cases ?? [{ id: 'case_1' }] }) })
      }
      if (url === '/api/bot-control/releases/preview') {
        return Promise.resolve({ ok: true, status: 200, json: async () => PREVIEW })
      }
      if (url.startsWith('/api/bot-control/releases?')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ items: [], page: 1, limit: 50, total: 0 }) })
      }
      if (url === '/api/bot-control/releases' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as { testRunId?: string; overrideFailedTest?: boolean; reason?: string }
        const gateSatisfied =
          body.testRunId === PASSED_RUN.id ||
          (body.overrideFailedTest === true && (body.reason ?? '').trim().length >= 10)
        if (!gateSatisfied) {
          return Promise.resolve({
            ok: false,
            status: 409,
            json: async () => ({ error: 'Publish membutuhkan test run yang lulus, dan belum ada yang dilampirkan.' }),
          })
        }
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ id: 'rel_9', version: 9 }) })
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) })
    })
  )
}

function publishCalls() {
  return calls.filter((c) => c.url === '/api/bot-control/releases' && c.init?.method === 'POST')
}

function publishBody(index = 0) {
  return JSON.parse(String(publishCalls()[index].init?.body)) as Record<string, unknown>
}

async function fillTitle(text = 'Release uji') {
  fireEvent.change(screen.getByLabelText('Judul release'), { target: { value: text } })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockFetch()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('ReleasesPage — gerbang test run (regresi Temuan 1)', () => {
  it('melampirkan testRunId yang dipilih, sehingga publish lolos gerbang dan bukan 409', async () => {
    render(<ReleasesPage />)
    await waitFor(() => expect(screen.getByLabelText('Test run yang dilampirkan')).toBeInTheDocument())

    await fillTitle()
    fireEvent.change(screen.getByLabelText('Test run yang dilampirkan'), { target: { value: PASSED_RUN.id } })
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))

    await waitFor(() => expect(publishCalls()).toHaveLength(1))
    expect(publishBody().testRunId).toBe(PASSED_RUN.id)
    // The stub answers 409 for any body the real gate would refuse, so the absence of that
    // message plus the cleared title is the page reporting a publish that actually went through.
    await waitFor(() => expect(screen.getByLabelText('Judul release')).toHaveValue(''))
    expect(screen.queryByText(/belum ada yang dilampirkan/)).not.toBeInTheDocument()
  })

  it('menonaktifkan Publish selama belum ada test run yang dilampirkan', async () => {
    render(<ReleasesPage />)
    await waitFor(() => expect(screen.getByLabelText('Test run yang dilampirkan')).toBeInTheDocument())

    await fillTitle()
    expect(screen.getByRole('button', { name: 'Publish' })).toBeDisabled()
    expect(screen.getByText('Pilih test run yang lulus untuk melanjutkan.')).toBeInTheDocument()

    // The bug was a button that looked pressable and could only 409; it must not fire at all.
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
    expect(publishCalls()).toHaveLength(0)
  })

  it('hanya menawarkan test run yang lulus, karena run gagal pasti ditolak gerbang', async () => {
    render(<ReleasesPage />)
    await waitFor(() => expect(screen.getByLabelText('Test run yang dilampirkan')).toBeInTheDocument())

    const requested = calls.filter((c) => c.url.startsWith('/api/bot-control/test-runs')).map((c) => c.url)
    expect(requested).toHaveLength(1)
    expect(requested[0]).toContain('status=PASSED')
  })

  it('mengarahkan operator ke Test Lab saat belum ada run yang lulus', async () => {
    mockFetch({ runs: [] })
    render(<ReleasesPage />)

    await waitFor(() => expect(screen.getByText(/Belum ada test run yang lulus/)).toBeInTheDocument())
    expect(screen.getByRole('link', { name: 'jalankan suite di Test Lab' })).toHaveAttribute(
      'href',
      '/bot-control/test-lab'
    )
  })
})

describe('ReleasesPage — override OWNER', () => {
  it('tidak menampilkan override untuk ADMIN, karena API akan menolaknya', async () => {
    render(<ReleasesPage />)
    await waitFor(() => expect(screen.getByLabelText('Test run yang dilampirkan')).toBeInTheDocument())

    expect(screen.queryByText(/khusus OWNER/)).not.toBeInTheDocument()
  })

  it('mengirim overrideFailedTest beserta alasannya untuk OWNER', async () => {
    mockFetch({ role: 'OWNER', runs: [] })
    render(<ReleasesPage />)
    await waitFor(() => expect(screen.getByText(/khusus OWNER/)).toBeInTheDocument())

    await fillTitle()
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.change(screen.getByLabelText('Alasan override test'), {
      target: { value: 'Kasus uji harganya sendiri yang salah, perbaikannya butuh publish ini.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))

    await waitFor(() => expect(publishCalls()).toHaveLength(1))
    expect(publishBody().overrideFailedTest).toBe(true)
    expect(String(publishBody().reason)).toContain('Kasus uji harganya sendiri')
  })

  it('menahan override OWNER sampai alasannya cukup panjang', async () => {
    mockFetch({ role: 'OWNER', runs: [] })
    render(<ReleasesPage />)
    await waitFor(() => expect(screen.getByText(/khusus OWNER/)).toBeInTheDocument())

    await fillTitle()
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.change(screen.getByLabelText('Alasan override test'), { target: { value: 'pendek' } })

    expect(screen.getByRole('button', { name: 'Publish' })).toBeDisabled()
    expect(screen.getByText('Alasan override minimal 10 karakter.')).toBeInTheDocument()
  })
})

/**
 * Regression cover for the audit finding "Test run tidak bisa menguji versi draft".
 *
 * Finding 1 made publish require a passing run; without these, the only run an operator could
 * attach from this page would have exercised the configuration already live — so the gate would
 * be satisfied by a run that proved nothing about what was being shipped.
 */
describe('ReleasesPage — test pra-release (regresi Temuan 4)', () => {
  async function openPreview() {
    render(<ReleasesPage />)
    await waitFor(() => expect(screen.getByLabelText('Test run yang dilampirkan')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Preview perubahan' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Jalankan test pra-release' })).toBeInTheDocument())
  }

  it('mengirim candidate dari preview, bukan menjalankan suite terhadap versi yang sudah live', async () => {
    await openPreview()
    fireEvent.click(screen.getByRole('button', { name: 'Jalankan test pra-release' }))

    await waitFor(() => {
      const post = calls.find((c) => c.url === '/api/bot-control/test-runs' && c.init?.method === 'POST')
      expect(post).toBeDefined()
    })
    const post = calls.find((c) => c.url === '/api/bot-control/test-runs' && c.init?.method === 'POST')
    const body = JSON.parse(String(post?.init?.body)) as Record<string, unknown>
    expect(body.scope).toBe('PRE_RELEASE')
    expect(body.candidate).toEqual(PREVIEW.candidate)
    expect(body.testCaseIds).toEqual(['case_1'])
  })

  it('melampirkan run yang lulus, sehingga Publish langsung siap', async () => {
    await openPreview()
    fireEvent.click(screen.getByRole('button', { name: 'Jalankan test pra-release' }))
    fireEvent.change(screen.getByLabelText('Judul release'), { target: { value: 'Release uji' } })

    await waitFor(() => expect(screen.getByRole('button', { name: 'Publish' })).not.toBeDisabled())
  })

  it('tidak melampirkan run yang gagal, dan mengatakan kenapa', async () => {
    // Attaching it would only produce a 409 at publish; saying so here is the useful answer.
    mockFetch({ runStatus: 'FAILED' })
    await openPreview()
    fireEvent.click(screen.getByRole('button', { name: 'Jalankan test pra-release' }))

    await waitFor(() => expect(screen.getByText(/Test run gagal/)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Publish' })).toBeDisabled()
  })

  it('menolak menjalankan suite kosong, yang akan lulus tanpa memeriksa apa pun', async () => {
    mockFetch({ cases: [] })
    await openPreview()
    fireEvent.click(screen.getByRole('button', { name: 'Jalankan test pra-release' }))

    await waitFor(() => expect(screen.getByText(/Belum ada kasus uji aktif/)).toBeInTheDocument())
  })
})
