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

type Opts = { role?: string; runs?: (typeof PASSED_RUN)[] }

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
      if (url.startsWith('/api/bot-control/test-runs')) {
        const items = opts.runs ?? [PASSED_RUN]
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ items, page: 1, limit: 20, total: items.length }) })
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
    expect(screen.getByRole('link', { name: 'Jalankan suite di Test Lab' })).toHaveAttribute(
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
