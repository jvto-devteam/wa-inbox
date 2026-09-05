/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { verifySessionToken } from '@/lib/auth/session'
import { generateBotDocumentation } from '@/lib/bot-control/documentation-exporter'
import { GET } from './route'

vi.mock('@/lib/auth/session', () => ({ verifySessionToken: vi.fn() }))
vi.mock('@/lib/bot-control/documentation-exporter', () => ({ generateBotDocumentation: vi.fn() }))

function req(withSession = true) {
  return new Request('http://localhost/api/bot-control/export-docs', {
    headers: withSession ? { cookie: 'wa_inbox_session=tok' } : {},
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_admin', role: 'ADMIN', tokenVersion: 0 })
  vi.mocked(generateBotDocumentation).mockResolvedValue('# Dokumentasi Bot\n\n## Ringkasan Bot')
})

describe('GET /api/bot-control/export-docs', () => {
  it('returns the document as Markdown, not JSON', async () => {
    const res = await GET(req())
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('text/markdown')
    expect(await res.text()).toContain('# Dokumentasi Bot')
  })

  it('names the file for a direct browser hit', async () => {
    const res = await GET(req())
    expect(res.headers.get('Content-Disposition')).toContain('wa-inbox-bot-documentation.md')
  })

  it('is never cached — the whole value of the document is that it reflects the system now', async () => {
    const res = await GET(req())
    expect(res.headers.get('Cache-Control')).toBe('no-store')
  })

  it('refuses an AGENT', async () => {
    vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_1', role: 'AGENT', tokenVersion: 0 })

    const res = await GET(req())
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Hanya admin yang bisa mengekspor dokumentasi' })
    expect(generateBotDocumentation).not.toHaveBeenCalled()
  })

  it('refuses a request with no session before generating anything', async () => {
    const res = await GET(req(false))
    expect(res.status).toBe(403)
    expect(generateBotDocumentation).not.toHaveBeenCalled()
  })

  it('answers a failure as JSON { error }, never as half a Markdown file', async () => {
    // An error is not a document; emitting one as text/markdown would be indistinguishable
    // from a real export to anything downstream.
    vi.mocked(generateBotDocumentation).mockRejectedValue(new Error('db down'))

    const res = await GET(req())
    expect(res.status).toBe(500)
    expect(res.headers.get('Content-Type')).toContain('application/json')
    expect(await res.json()).toEqual({ error: 'Gagal membuat dokumentasi' })
  })
})
