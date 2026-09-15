/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { verifySessionToken } from '@/lib/auth/session'
import { sendDraft } from '@/lib/inbox/message-draft'
import { POST } from './route'

vi.mock('@/lib/auth/session', () => ({ verifySessionToken: vi.fn() }))
vi.mock('@/lib/inbox/message-draft', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/inbox/message-draft')>()
  return { ...actual, sendDraft: vi.fn() }
})

const CONVERSATION_ID = 'conv_1'
const MESSAGE_ID = 'msg_1'

const result = {
  draft: {
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
    sentAt: '2026-09-14T08:05:00.000Z',
    sentByName: 'Agen Satu',
    sentMessageId: 'msg_sent',
  },
  message: {
    id: 'msg_sent',
    direction: 'OUTBOUND',
    type: 'text',
    content: 'Halo, paket Ijen mulai Rp1.200.000.',
    mediaUrl: null,
    mimeType: null,
    fileName: null,
    channel: 'UNOFFICIAL',
    sentBy: 'AGENT',
    deliveryStatus: 'SENT',
    createdAt: '2026-09-14T08:05:00.000Z',
    botTrace: { mode: 'faq', draft: 'Halo, paket Ijen mulai Rp1.200.000.', sourceTopic: 'price' },
    topicLabels: null,
    knowledgeGap: null,
    replyTo: { id: MESSAGE_ID, content: 'Berapa harga paket Ijen 2D1N?', type: 'text', sentBy: 'CUSTOMER' },
    templatePayload: null,
  },
}

function params() {
  return { params: Promise.resolve({ id: CONVERSATION_ID, messageId: MESSAGE_ID }) }
}

function req(withSession = true) {
  return new Request(`http://localhost/api/conversations/${CONVERSATION_ID}/messages/${MESSAGE_ID}/draft/send`, {
    method: 'POST',
    headers: withSession ? { cookie: 'wa_inbox_session=tok' } : {},
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(verifySessionToken).mockResolvedValue({ accountId: 'acc_1', role: 'AGENT', tokenVersion: 0 })
  vi.mocked(sendDraft).mockResolvedValue(result as never)
})

describe('POST .../draft/send', () => {
  it('401 tanpa sesi, layanan tidak dipanggil', async () => {
    const res = await POST(req(false), params())
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Tidak terautentikasi' })
    expect(sendDraft).not.toHaveBeenCalled()
  })

  it('400 kalau params tidak valid', async () => {
    const res = await POST(req(), { params: Promise.resolve({ id: CONVERSATION_ID, messageId: '  ' }) })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Alamat pesan tidak valid' })
    expect(sendDraft).not.toHaveBeenCalled()
  })

  it('jalur sukses memanggil sendDraft dan mengembalikan draft + pesan terkirim', async () => {
    const res = await POST(req(), params())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(result)
    expect(sendDraft).toHaveBeenCalledWith({ conversationId: CONVERSATION_ID, messageId: MESSAGE_ID, accountId: 'acc_1' })
  })

  it('DraftError diteruskan dengan status dan pesannya sendiri', async () => {
    const { DraftError } = await import('@/lib/inbox/message-draft')
    vi.mocked(sendDraft).mockRejectedValue(new DraftError(400, 'Draft kosong, tulis jawabannya dulu'))
    const res = await POST(req(), params())
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Draft kosong, tulis jawabannya dulu' })
  })

  it('500 dengan pesan generik bila layanan melempar error lain', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(sendDraft).mockRejectedValue(new Error('provider down'))
    const res = await POST(req(), params())
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Gagal mengirim draft' })
  })
})
