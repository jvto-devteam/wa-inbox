import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MessageDraftCard } from './MessageDraftCard'
import type { MessageDraftView } from '@/lib/inbox/message-draft-view'

vi.mock('./BotTracePopover', () => ({
  BotTracePopover: ({ onClose }: { onClose: () => void }) => (
    <div>
      alasan bot popover
      <button type="button" onClick={onClose}>
        tutup popover
      </button>
    </div>
  ),
}))

function baseDraft(overrides: Partial<MessageDraftView> = {}): MessageDraftView {
  return {
    id: 'draft_1',
    sourceMessageId: 'm_in',
    text: 'Harga paket Ijen 3D2N mulai Rp1.500.000 per orang.',
    generatedText: 'Harga paket Ijen 3D2N mulai Rp1.500.000 per orang.',
    mode: 'faq',
    handoffReason: null,
    decision: { mode: 'faq', draft: 'Harga paket Ijen 3D2N mulai Rp1.500.000 per orang.', sourceTopic: 'price' },
    knowledgeGaps: [],
    generatedAt: '2026-09-15T01:00:00.000Z',
    generatedByName: null,
    editedAt: null,
    editedByName: null,
    sentAt: null,
    sentByName: null,
    sentMessageId: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('MessageDraftCard', () => {
  it('menampilkan judul, teks draft, dan status belum terkirim', () => {
    render(<MessageDraftCard draft={baseDraft()} conversationId="conv_1" messageId="m_in" />)

    expect(screen.getByText('Draft jawaban bot')).toBeInTheDocument()
    expect(screen.getByText('Harga paket Ijen 3D2N mulai Rp1.500.000 per orang.')).toBeInTheDocument()
    expect(screen.getByText('Belum terkirim')).toBeInTheDocument()
  })

  it('menampilkan peringatan gap untuk tiap knowledgeGaps, dengan pertanyaan dalam tanda kutip bila ada', () => {
    const { container } = render(
      <MessageDraftCard
        draft={baseDraft({
          knowledgeGaps: [
            { reason: 'reply_deferred_knowledge', missingQuestion: 'Apakah ada diskon rombongan?' },
            { reason: 'no_facts_resolved', missingQuestion: null },
          ],
        })}
        conversationId="conv_1"
        messageId="m_in"
      />
    )

    expect(screen.getByText(/Ada bagian jawaban yang belum punya knowledge/)).toBeInTheDocument()
    expect(screen.getByText(/"Apakah ada diskon rombongan\?"/)).toBeInTheDocument()
    expect(screen.getByText('Tidak ada fakta knowledge untuk pertanyaan ini')).toBeInTheDocument()
    expect(container.querySelector('.border-warning')).toBeInTheDocument()
  })

  it('menampilkan kalimat handoff saat teks kosong dan mode handoff', () => {
    render(
      <MessageDraftCard
        draft={baseDraft({ text: null, mode: 'handoff', handoffReason: 'Pelanggan minta bicara dengan manusia' })}
        conversationId="conv_1"
        messageId="m_in"
      />
    )

    expect(
      screen.getByText('Bot memilih menyerahkan ke agen: Pelanggan minta bicara dengan manusia. Tulis jawabannya lewat Edit draft.')
    ).toBeInTheDocument()
  })

  it('edit draft: Edit draft membuka pilihan edit manual dan edit dengan prompt', () => {
    render(<MessageDraftCard draft={baseDraft()} conversationId="conv_1" messageId="m_in" />)

    fireEvent.click(screen.getByRole('button', { name: 'Edit draft' }))

    expect(screen.getByRole('menuitem', { name: 'Edit manual' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Edit dengan prompt' })).toBeInTheDocument()
  })

  it('edit draft manual: Edit manual membuka Textarea, Simpan mem-PATCH lalu memanggil onDraftChange', async () => {
    const updated = baseDraft({ text: 'Teks yang sudah diedit.', editedAt: '2026-09-15T02:00:00.000Z', editedByName: 'Agen Dewi' })
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => updated } as Response)
    const onDraftChange = vi.fn()

    render(<MessageDraftCard draft={baseDraft()} conversationId="conv_1" messageId="m_in" onDraftChange={onDraftChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'Edit draft' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit manual' }))
    const textarea = screen.getByLabelText('Edit draft')
    fireEvent.change(textarea, { target: { value: 'Teks yang sudah diedit.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Simpan' }))

    await waitFor(() => expect(onDraftChange).toHaveBeenCalledWith('m_in', updated))
    const [url, init] = vi.mocked(fetch).mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/conversations/conv_1/messages/m_in/draft')
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(init.body as string)).toEqual({ text: 'Teks yang sudah diedit.' })
  })

  it('edit dengan prompt: mengirim prompt revisi ke .../draft/revise lalu memanggil onDraftChange', async () => {
    const updated = baseDraft({ text: 'Versi revisi dari prompt.', editedAt: '2026-09-15T02:00:00.000Z', editedByName: 'Agen Dewi' })
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => updated } as Response)
    const onDraftChange = vi.fn()

    render(<MessageDraftCard draft={baseDraft()} conversationId="conv_1" messageId="m_in" onDraftChange={onDraftChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'Edit draft' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit dengan prompt' }))
    fireEvent.change(screen.getByLabelText('Prompt revisi draft'), { target: { value: 'Buat lebih singkat dan sebutkan pickup Surabaya.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Revisi draft' }))

    await waitFor(() => expect(onDraftChange).toHaveBeenCalledWith('m_in', updated))
    const [url, init] = vi.mocked(fetch).mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/conversations/conv_1/messages/m_in/draft/revise')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ prompt: 'Buat lebih singkat dan sebutkan pickup Surabaya.' })
  })

  it('Batal menutup mode edit tanpa memanggil fetch', () => {
    render(<MessageDraftCard draft={baseDraft()} conversationId="conv_1" messageId="m_in" />)

    fireEvent.click(screen.getByRole('button', { name: 'Edit draft' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit manual' }))
    expect(screen.getByLabelText('Edit draft')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Batal' }))
    expect(screen.queryByLabelText('Edit draft')).not.toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('kirim: Kirim pesan mem-POST ke .../draft/send lalu memanggil onDraftSent', async () => {
    const sentDraft = baseDraft({ sentAt: '2026-09-15T03:00:00.000Z', sentByName: 'Agen Dewi' })
    const sentMessage = {
      id: 'm_out',
      direction: 'OUTBOUND' as const,
      content: 'Harga paket Ijen 3D2N mulai Rp1.500.000 per orang.',
      channel: 'OFFICIAL',
      sentBy: 'AGENT',
      deliveryStatus: 'PENDING',
      createdAt: '2026-09-15T03:00:00.000Z',
      botTrace: null,
      fromDraft: false,
    }
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ draft: sentDraft, message: sentMessage }) } as Response)
    const onDraftSent = vi.fn()

    render(<MessageDraftCard draft={baseDraft()} conversationId="conv_1" messageId="m_in" onDraftSent={onDraftSent} />)

    fireEvent.click(screen.getByRole('button', { name: 'Kirim pesan' }))

    await waitFor(() => expect(onDraftSent).toHaveBeenCalledWith('m_in', sentDraft, sentMessage))
    const [url, init] = vi.mocked(fetch).mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/conversations/conv_1/messages/m_in/draft/send')
    expect(init.method).toBe('POST')
  })

  it('Kirim pesan nonaktif saat teks draft kosong', () => {
    render(<MessageDraftCard draft={baseDraft({ text: '', mode: 'handoff', handoffReason: 'x' })} conversationId="conv_1" messageId="m_in" />)
    expect(screen.getByRole('button', { name: 'Kirim pesan' })).toBeDisabled()
  })

  it('galat generate ulang tampil sebagai teks text-danger', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: 'Gagal membuat ulang draft' }) } as Response)

    render(<MessageDraftCard draft={baseDraft()} conversationId="conv_1" messageId="m_in" />)
    fireEvent.click(screen.getByRole('button', { name: 'Generate ulang' }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Gagal membuat ulang draft'))
  })

  it('terkirim: badge Terkirim ke pelanggan dengan nama dan jam, tanpa tombol aksi apa pun', () => {
    render(
      <MessageDraftCard
        draft={baseDraft({ sentAt: '2026-09-15T03:45:00.000Z', sentByName: 'Agen Dewi' })}
        conversationId="conv_1"
        messageId="m_in"
      />
    )

    expect(screen.getByText('Terkirim ke pelanggan')).toBeInTheDocument()
    expect(screen.getByText(/oleh Agen Dewi/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Generate ulang' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit draft' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Kirim pesan' })).not.toBeInTheDocument()
  })

  it('tombol Lihat alasan bot membuka BotTracePopover', () => {
    render(<MessageDraftCard draft={baseDraft()} conversationId="conv_1" messageId="m_in" />)

    expect(screen.queryByText('alasan bot popover')).not.toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Lihat alasan bot'))
    expect(screen.getByText('alasan bot popover')).toBeInTheDocument()
  })
})
