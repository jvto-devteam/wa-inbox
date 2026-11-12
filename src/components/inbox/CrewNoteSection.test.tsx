import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor, act } from '@testing-library/react'
import { CrewNoteSection } from './CrewNoteSection'
import type { ChatReviewResponse } from '@/app/api/conversations/[id]/chat-review/route'
import type { CrewNote } from '@/lib/daily-summary/payload-schema'

const URL = '/api/conversations/conv_1/chat-review'

function note(overrides: Partial<CrewNote> = {}): CrewNote {
  return {
    diperbaruiAt: '2026-11-06T03:00:00.000Z',
    perubahan: [],
    waktuKritis: [],
    siapa: [],
    karakter: [],
    kebutuhan: [],
    permintaan: [],
    logistik: [],
    janjiTim: [],
    jangan: [],
    ...overrides,
  }
}

function body(catatanCrew?: CrewNote): ChatReviewResponse {
  return {
    latest: {
      review: {
        status: 'perlu_tindakan',
        alasan: 'a',
        jenisKontak: 'tamu_existing',
        topik: 't',
        pertanyaan: [],
        poinPenting: [],
        janjiTim: [],
        profil: [],
        statusAgen: '',
        langkahBerikut: '',
        ...(catatanCrew ? { catatanCrew } : {}),
      },
      at: '2026-11-06T03:00:00.000Z',
    },
    item: null,
    history: [],
    lastMessageAt: null,
    pinned: [],
    changeHistory: [],
    scheduleNote: null,
  }
}

function stubFetch(handler: () => ChatReviewResponse) {
  const fetchMock = vi.fn(async (...args: [RequestInfo | URL, RequestInit?]) => {
    void args
    return { ok: true, status: 200, json: async () => handler() } as Response
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

class FakeEventSource {
  static last: FakeEventSource | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  constructor(public url: string) {
    FakeEventSource.last = this
  }
  close() {}
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  FakeEventSource.last = null
})

describe('CrewNoteSection', () => {
  it('tanpa booking: tidak tampil dan tidak memanggil API', () => {
    const fetchMock = stubFetch(() => body(note()))
    const { container } = render(<CrewNoteSection conversationId="conv_1" hasBooking={false} />)
    expect(container).toBeEmptyDOMElement()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('menampilkan bagian yang berisi, berurutan, dengan penekanan pada perubahan dan jangan menjanjikan', async () => {
    stubFetch(() =>
      body(
        note({
          kebutuhan: ['Takut ketinggian di Tumpak Sewu. Jangan dipaksa turun.'],
          perubahan: ['Jemput tour 20 Nov jam 11:00, bukan 08:00.'],
          jangan: ['Jangan menjanjikan izin drone di air terjun. Bila tamu bertanya, kabari admin.'],
        })
      )
    )
    render(<CrewNoteSection conversationId="conv_1" hasBooking />)
    expect(await screen.findByText('Jemput tour 20 Nov jam 11:00, bukan 08:00.')).toBeInTheDocument()
    const headings = screen.getAllByText(/^(⚠ )?(Perubahan terbaru|Kebutuhan|Jangan menjanjikan)$/).map((n) => n.textContent)
    expect(headings).toEqual(['⚠ Perubahan terbaru', 'Kebutuhan', '⚠ Jangan menjanjikan'])
    expect(screen.queryByText('Waktu kritis')).not.toBeInTheDocument()
    expect(screen.getByText(/dibaca crew di aplikasi crew/)).toBeInTheDocument()
  })

  it('catatan ada tetapi kosong: pesan netral', async () => {
    stubFetch(() => body(note()))
    render(<CrewNoteSection conversationId="conv_1" hasBooking />)
    expect(await screen.findByText(/Belum ada hal dari chat ini yang perlu diketahui crew/)).toBeInTheDocument()
  })

  it('belum ada catatan (fitur mati atau belum diproses): bagian tidak tampil', async () => {
    const fetchMock = stubFetch(() => body())
    const { container } = render(<CrewNoteSection conversationId="conv_1" hasBooking />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(fetchMock.mock.calls[0][0]).toBe(URL)
    await waitFor(() => expect(container.querySelector('section')).toBeNull())
  })

  it('ikut hidup: memuat ulang saat conversation.updated untuk percakapan ini, mengabaikan yang lain', async () => {
    vi.stubGlobal('EventSource', FakeEventSource)
    let current = note({ waktuKritis: ['Tiba di Juanda 16:40, jemput 17:30.'] })
    const fetchMock = stubFetch(() => body(current))
    render(<CrewNoteSection conversationId="conv_1" hasBooking />)
    expect(await screen.findByText('Tiba di Juanda 16:40, jemput 17:30.')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    current = note({ waktuKritis: ['Tiba di Juanda 17:10, jemput 18:00.'] })
    act(() => FakeEventSource.last!.onmessage!({ data: JSON.stringify({ type: 'conversation.updated', conversationId: 'conv_2' }) }))
    expect(fetchMock).toHaveBeenCalledTimes(1)

    act(() => FakeEventSource.last!.onmessage!({ data: JSON.stringify({ type: 'conversation.updated', conversationId: 'conv_1' }) }))
    expect(await screen.findByText('Tiba di Juanda 17:10, jemput 18:00.')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
