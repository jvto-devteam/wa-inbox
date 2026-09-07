'use client'
import { useCallback, useEffect, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { fetchJson } from '@/lib/fetch-json'

export type TestCaseRow = {
  id: string
  name: string
  description: string | null
  category: string | null
  inputText: string
  expectedStatus: string | null
  expectedContains: string | null
  expectedNotContains: string | null
  expectedHandoff: boolean | null
  enabled: boolean
}

export type TestResultRow = {
  id: string
  testCaseId: string
  testCaseName: string | null
  status: string
  inputText: string
  actualStatus: string | null
  actualReply: string | null
  failureReason: string | null
  latencyMs: number | null
}

export type TestRunDetail = {
  id: string
  status: string
  total: number
  passed: number
  failed: number
  skipped: number
  results: TestResultRow[]
}

const RESULT_VARIANT: Record<string, 'success' | 'destructive' | 'muted'> = {
  PASSED: 'success',
  FAILED: 'destructive',
  SKIPPED: 'muted',
}

/** Matches the runner's own cap; asking for more is rejected by the API. */
const MAX_PER_RUN = 50

/**
 * The saved suite: list, toggle, run, and read what failed.
 *
 * Selection defaults to every ENABLED case rather than to nothing. The common action is "run
 * the suite", and making an operator tick fifty boxes to do the common thing is how the suite
 * stops being run.
 *
 * A failing result shows its `failureReason` verbatim, not a generic "gagal". The runner
 * deliberately produces a readable sentence ("status WOULD_HANDOFF, diharapkan WOULD_REPLY"),
 * and hiding it behind a badge would throw away the only part that tells somebody what to fix.
 */
export function SavedTestCases({ canRun = false, refreshToken = 0 }: { canRun?: boolean; refreshToken?: number }) {
  const [cases, setCases] = useState<TestCaseRow[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [category, setCategory] = useState('')
  const [enabledFilter, setEnabledFilter] = useState('')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [running, setRunning] = useState(false)
  const [run, setRun] = useState<TestRunDetail | null>(null)

  const load = useCallback(() => {
    const params = new URLSearchParams()
    if (category) params.set('category', category)
    if (enabledFilter) params.set('enabled', enabledFilter)
    if (query.trim()) params.set('q', query.trim())

    return fetchJson<{ items: TestCaseRow[]; categories: string[] }>(`/api/bot-control/test-cases?${params}`)
      .then((data) => {
        setCases(data.items)
        setCategories(data.categories)
        // Default to every enabled case: the common action is "run the suite".
        setSelected(new Set(data.items.filter((row) => row.enabled).map((row) => row.id)))
        setError(null)
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Gagal memuat kasus uji'))
      .finally(() => setLoading(false))
  }, [category, enabledFilter, query])

  useEffect(() => {
    void load()
  }, [load, refreshToken])

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function setEnabled(row: TestCaseRow, enabled: boolean) {
    setError(null)
    try {
      await fetchJson(`/api/bot-control/test-cases/${row.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      })
      await load()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal mengubah kasus uji')
    }
  }

  async function runSelected() {
    if (running || selected.size === 0) return
    setRunning(true)
    setError(null)
    setRun(null)
    try {
      const started = await fetchJson<{ testRunId: string }>('/api/bot-control/test-runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: 'PRE_RELEASE', testCaseIds: [...selected].slice(0, MAX_PER_RUN) }),
      })
      // The POST returns tallies; the detail endpoint is what carries per-case failures, which
      // is the part an operator actually needs to act on.
      setRun(await fetchJson<TestRunDetail>(`/api/bot-control/test-runs/${started.testRunId}`))
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal menjalankan test run')
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Cari kasus uji..."
          aria-label="Cari kasus uji"
          className="w-56"
        />
        <Select value={category} onChange={(e) => setCategory(e.target.value)} className="w-auto" aria-label="Filter kategori">
          <option value="">Semua kategori</option>
          {categories.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </Select>
        <Select
          value={enabledFilter}
          onChange={(e) => setEnabledFilter(e.target.value)}
          className="w-auto"
          aria-label="Filter status aktif"
        >
          <option value="">Aktif dan nonaktif</option>
          <option value="true">Hanya aktif</option>
          <option value="false">Hanya nonaktif</option>
        </Select>

        {canRun && (
          <Button className="ml-auto" onClick={runSelected} disabled={running || selected.size === 0}>
            {running ? 'Menjalankan...' : `Jalankan ${selected.size} kasus`}
          </Button>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {loading && <p className="text-sm text-muted-foreground">Memuat kasus uji...</p>}

      {!loading && cases.length === 0 && (
        <Card className="p-3">
          <p className="text-sm text-muted-foreground">
            Belum ada kasus uji. Jalankan simulasi di atas, lalu simpan hasilnya sebagai kasus uji.
          </p>
        </Card>
      )}

      {!loading && cases.length > 0 && (
        <Card className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>Kasus</TableHead>
                <TableHead>Kategori</TableHead>
                <TableHead>Ekspektasi</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {cases.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <input
                      type="checkbox"
                      checked={selected.has(row.id)}
                      onChange={() => toggleSelected(row.id)}
                      aria-label={`Pilih ${row.name}`}
                    />
                  </TableCell>
                  <TableCell className="text-xs">
                    <p className="font-medium text-navy">{row.name}</p>
                    <p className="text-muted-foreground">{row.inputText}</p>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{row.category ?? '—'}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {[
                      row.expectedStatus,
                      row.expectedContains && `memuat "${row.expectedContains}"`,
                      row.expectedNotContains && `tanpa "${row.expectedNotContains}"`,
                      row.expectedHandoff === true && 'handoff',
                      row.expectedHandoff === false && 'tanpa handoff',
                    ]
                      .filter(Boolean)
                      .join(', ') || '—'}
                  </TableCell>
                  <TableCell>
                    <Badge variant={row.enabled ? 'success' : 'muted'}>{row.enabled ? 'Aktif' : 'Nonaktif'}</Badge>
                  </TableCell>
                  <TableCell>
                    {canRun && (
                      <Button variant="outline" size="sm" onClick={() => setEnabled(row, !row.enabled)}>
                        {row.enabled ? 'Nonaktifkan' : 'Aktifkan'}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {run && (
        <Card className="space-y-2 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={run.status === 'PASSED' ? 'success' : 'destructive'}>{run.status}</Badge>
            <span className="text-xs text-muted-foreground">
              {run.passed} lulus &middot; {run.failed} gagal &middot; {run.skipped} dilewati &middot; total {run.total}
            </span>
          </div>

          <ol className="space-y-2">
            {run.results.map((result) => (
              <li key={result.id} className="space-y-1 rounded border p-2 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={RESULT_VARIANT[result.status] ?? 'muted'}>{result.status}</Badge>
                  <span className="text-navy">{result.testCaseName ?? '(kasus terhapus)'}</span>
                  {result.latencyMs !== null && (
                    <span className="ml-auto text-muted-foreground">{result.latencyMs} ms</span>
                  )}
                </div>
                <p className="text-muted-foreground">{result.inputText}</p>
                {/* Verbatim, not a generic "gagal": the runner produces a readable sentence and
                    it is the only part that says what to fix. */}
                {result.failureReason && <p className="text-destructive">{result.failureReason}</p>}
                {result.actualReply && <p className="text-navy">Balasan: {result.actualReply}</p>}
              </li>
            ))}
          </ol>
        </Card>
      )}
    </div>
  )
}
