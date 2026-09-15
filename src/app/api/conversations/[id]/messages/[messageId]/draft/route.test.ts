/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { verifySessionToken } from '@/lib/auth/session'
import { DraftError, generateDraft, editDraft } from '@/lib/inbox/message-draft'
import { POST, PATCH } from './route'

vi.mock('@/lib/auth/session', () => ({ verifySessionToken: vi.fn() }))
vi.mock('@/lib/inbox/message-draft', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/inbox/message-draft')>()
  return { ...actual, generateDraft: vi.fn(), editDraft: vi.fn() }
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
  editedAt: null,
  editedByName: null,
  sentAt: null,
  sentByName: null,
  sentMessageId: null,
}

function params() {
  return { params: Promise.resolve({ id: CONVERSATION_ID, messageId: MESSAGE_ID }) }
}

function postReq(withSession = true) {
  return new Request(`http://localhost/api/conversations/${CONVERSATION_ID}/messages/${MESSAGE_ID}/draft`, {
    method: 'POST',
    headers: withSession ? { cookie: 'wa_inbox_session=tok' } : {},
  })
}

function patchReq(body: unknown, withSession = true) {
  return new Request(`http://localhost/api/conversations/${CONVERSATION_ID}/messages/${MESSAGE_ID}/draft`, {
    method: 'PATCH',
    headers: withSession ? { cookie: 'wa_inbox_session=tok', 'Content-Type': 'application/json' } : {},
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_1', role: 'AGENT', tokenVersion: 0 })
  vi.mocked(generateDraft).mockResolvedValue(draftView as never)
  vi.mocked(editDraft).mockResolvedValue(draftView as never)
})

describe('POST .../draft', () => {
  it('401 tanpa sesi, layanan tidak dipanggil', async () => {
    const res = await POST(postReq(false), params())
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Tidak terautentikasi' })
    expect(generateDraft).not.toHaveBeenCalled()
  })

  it('400 kalau params tidak valid', async () => {
    const res = await POST(postReq(), { params: Promise.resolve({ id: '', messageId: MESSAGE_ID }) })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Alamat pesan tidak valid' })
    expect(generateDraft).not.toHaveBeenCalled()
  })

  it('jalur sukses memanggil generateDraft dan mengembalikan draft-nya', async () => {
    const res = await POST(postReq(), params())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(draftView)
    expect(generateDraft).toHaveBeenCalledWith({ conversationId: CONVERSATION_ID, messageId: MESSAGE_ID, accountId: 'acc_1' })
  })

  it('DraftError diteruskan dengan status dan pesannya sendiri', async () => {
    vi.mocked(generateDraft).mockRejectedValue(new DraftError(409, 'Draft sudah terkirim dan terkunci'))
    const res = await POST(postReq(), params())
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'Draft sudah terkirim dan terkunci' })
  })

  it('500 dengan pesan generik bila layanan melempar error lain', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(generateDraft).mockRejectedValue(new Error('boom'))
    const res = await POST(postReq(), params())
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Gagal membuat draft' })
  })
})

describe('PATCH .../draft', () => {
  it('401 tanpa sesi, layanan tidak dipanggil', async () => {
    const res = await PATCH(patchReq({ text: 'x' }, false), params())
    expect(res.status).toBe(401)
    expect(editDraft).not.toHaveBeenCalled()
  })

  it('400 Zod: field tambahan ditolak (.strict())', async () => {
    const res = await PATCH(patchReq({ text: 'x', extra: true }), params())
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Draft tidak boleh kosong' })
    expect(editDraft).not.toHaveBeenCalled()
  })

  it('400 kalau teks kosong setelah trim', async () => {
    const res = await PATCH(patchReq({ text: '   ' }), params())
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Draft tidak boleh kosong' })
    expect(editDraft).not.toHaveBeenCalled()
  })

  it('400 kalau params tidak valid', async () => {
    const res = await PATCH(patchReq({ text: 'x' }), { params: Promise.resolve({ id: CONVERSATION_ID, messageId: '' }) })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Alamat pesan tidak valid' })
  })

  it('jalur sukses memanggil editDraft dan mengembalikan draft-nya', async () => {
    const res = await PATCH(patchReq({ text: 'Versi baru' }), params())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(draftView)
    expect(editDraft).toHaveBeenCalledWith({ conversationId: CONVERSATION_ID, messageId: MESSAGE_ID, accountId: 'acc_1', text: 'Versi baru' })
  })

  it('DraftError diteruskan dengan status dan pesannya sendiri', async () => {
    vi.mocked(editDraft).mockRejectedValue(new DraftError(404, 'Draft belum dibuat'))
    const res = await PATCH(patchReq({ text: 'Versi baru' }), params())
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Draft belum dibuat' })
  })

  it('500 dengan pesan generik bila layanan melempar error lain', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(editDraft).mockRejectedValue(new Error('boom'))
    const res = await PATCH(patchReq({ text: 'Versi baru' }), params())
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Gagal menyimpan draft' })
  })
})
