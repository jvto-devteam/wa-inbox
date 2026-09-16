/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { verifySessionToken } from '@/lib/auth/session'
import { DraftError, reviseDraftWithPrompt } from '@/lib/inbox/message-draft'
import { POST } from './route'

vi.mock('@/lib/auth/session', () => ({ verifySessionToken: vi.fn() }))
vi.mock('@/lib/inbox/message-draft', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/inbox/message-draft')>()
  return { ...actual, reviseDraftWithPrompt: vi.fn() }
})

const CONVERSATION_ID = 'conv_1'
const MESSAGE_ID = 'msg_1'

const draftView = {
  id: 'draft_1',
  sourceMessageId: MESSAGE_ID,
  text: 'Halo, paket Ijen mulai Rp1.200.000.',
  generatedText: 'Halo, paket Ijen mulai Rp1.200.000.',
  mode: 'faq',
  handoffReason: null,
  decision: { mode: 'faq', draft: 'Halo, paket Ijen mulai Rp1.200.000.', sourceTopic: 'price' },
  knowledgeGaps: [],
  generatedAt: '2026-09-14T08:00:05.000Z',
  generatedByName: 'Agen Satu',
  editedAt: '2026-09-14T08:02:05.000Z',
  editedByName: 'Agen Satu',
  sentAt: null,
  sentByName: null,
  sentMessageId: null,
}

function params() {
  return { params: Promise.resolve({ id: CONVERSATION_ID, messageId: MESSAGE_ID }) }
}

function req(body: unknown, withSession = true) {
  return new Request(`http://localhost/api/conversations/${CONVERSATION_ID}/messages/${MESSAGE_ID}/draft/revise`, {
    method: 'POST',
    headers: withSession ? { cookie: 'wa_inbox_session=tok', 'Content-Type': 'application/json' } : {},
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_1', role: 'AGENT', tokenVersion: 0 })
  vi.mocked(reviseDraftWithPrompt).mockResolvedValue(draftView as never)
})

describe('POST .../draft/revise', () => {
  it('401 tanpa sesi, layanan tidak dipanggil', async () => {
    const res = await POST(req({ prompt: 'singkatkan' }, false), params())
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Tidak terautentikasi' })
    expect(reviseDraftWithPrompt).not.toHaveBeenCalled()
  })

  it('400 kalau params tidak valid', async () => {
    const res = await POST(req({ prompt: 'singkatkan' }), { params: Promise.resolve({ id: '', messageId: MESSAGE_ID }) })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Alamat pesan tidak valid' })
    expect(reviseDraftWithPrompt).not.toHaveBeenCalled()
  })

  it('400 Zod: prompt kosong ditolak', async () => {
    const res = await POST(req({ prompt: '   ' }), params())
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Prompt revisi tidak boleh kosong' })
    expect(reviseDraftWithPrompt).not.toHaveBeenCalled()
  })

  it('jalur sukses memanggil reviseDraftWithPrompt dan mengembalikan draft-nya', async () => {
    const res = await POST(req({ prompt: 'Buat lebih singkat' }), params())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(draftView)
    expect(reviseDraftWithPrompt).toHaveBeenCalledWith({
      conversationId: CONVERSATION_ID,
      messageId: MESSAGE_ID,
      accountId: 'acc_1',
      prompt: 'Buat lebih singkat',
    })
  })

  it('DraftError diteruskan dengan status dan pesannya sendiri', async () => {
    vi.mocked(reviseDraftWithPrompt).mockRejectedValue(new DraftError(409, 'Draft sudah terkirim dan terkunci'))
    const res = await POST(req({ prompt: 'Buat lebih singkat' }), params())
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'Draft sudah terkirim dan terkunci' })
  })

  it('500 dengan pesan generik bila layanan melempar error lain', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(reviseDraftWithPrompt).mockRejectedValue(new Error('boom'))
    const res = await POST(req({ prompt: 'Buat lebih singkat' }), params())
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Gagal merevisi draft' })
  })
})
