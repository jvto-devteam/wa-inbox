import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor, act } from '@testing-library/react'
import { ScheduleNoteSection } from './ScheduleNoteSection'
import type { ChatReviewResponse } from '@/app/api/conversations/[id]/chat-review/route'
import type { ScheduleNote } from '@/lib/chat-review/schedule-note'

const URL = '/api/conversations/conv_1/chat-review'

function body(scheduleNote: ScheduleNote | null): ChatReviewResponse {
  return { latest: null, item: null, history: [], lastMessageAt: null, pinned: [], changeHistory: [], scheduleNote }
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

const NOTE: ScheduleNote = { baris: ['Strict vegetarian', 'Request kuda Bromo'], diperbaruiAt: '2026-11-12T05:00:00.000Z' }

describe('ScheduleNoteSection', () => {
  it('tanpa booking: tidak tampil dan tidak memanggil API', () => {
    const fetchMock = stubFetch(() => body(NOTE))
    const { container } = render(<ScheduleNoteSection conversationId="conv_1" hasBooking={false} />)
    expect(container).toBeEmptyDOMElement()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('menampilkan baris note dan jujur bahwa belum dikirim ke Schedule', async () => {
    const fetchMock = stubFetch(() => body(NOTE))
    render(<ScheduleNoteSection conversationId="conv_1" hasBooking />)
    expect(await screen.findByText('Strict vegetarian')).toBeInTheDocument()
    expect(screen.getByText('Request kuda Bromo')).toBeInTheDocument()
    expect(screen.getByText('Note untuk Schedule')).toBeInTheDocument()
    expect(screen.getByText(/belum dikirim ke Schedule/)).toBeInTheDocument()
    expect(fetchMock.mock.calls[0][0]).toBe(URL)
  })

  it('tidak ada note layak: bagian tidak tampil', async () => {
    const fetchMock = stubFetch(() => body(null))
    const { container } = render(<ScheduleNoteSection conversationId="conv_1" hasBooking />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    await waitFor(() => expect(container.querySelector('section')).toBeNull())
  })

  it('memuat ulang saat conversation.updated untuk percakapan ini, mengabaikan yang lain', async () => {
    vi.stubGlobal('EventSource', FakeEventSource)
    let current: ScheduleNote | null = NOTE
    const fetchMock = stubFetch(() => body(current))
    render(<ScheduleNoteSection conversationId="conv_1" hasBooking />)
    expect(await screen.findByText('Strict vegetarian')).toBeInTheDocument()
    const calls = fetchMock.mock.calls.length

    current = { baris: ['Gluten free diet'], diperbaruiAt: '2026-11-12T06:00:00.000Z' }
    act(() => FakeEventSource.last?.onmessage?.({ data: JSON.stringify({ type: 'conversation.updated', conversationId: 'conv_2' }) }))
    expect(fetchMock.mock.calls.length).toBe(calls)
    act(() => FakeEventSource.last?.onmessage?.({ data: JSON.stringify({ type: 'conversation.updated', conversationId: 'conv_1' }) }))
    expect(await screen.findByText('Gluten free diet')).toBeInTheDocument()
  })
})
