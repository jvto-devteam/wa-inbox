/**
 * Menambah satu anggota ke union `RealtimeEvent` berarti setiap tab yang sudah terbuka mulai
 * menerima jenis event yang belum pernah dilihatnya. Tiga konsumen SSE yang ada -- inbox
 * (ConversationList), thread (ThreadView), dan notifikasi (NotificationListener) -- semuanya
 * memakai satu `EventSource('/api/sse')` yang sama, jadi `pipeline.step` sampai ke ketiganya
 * baik mereka peduli atau tidak.
 *
 * Ketiganya memang sudah menyaring lewat `event.type` masing-masing, jadi tidak ada satu pun
 * yang perlu diubah. Justru karena itu test ini ada: yang menjaga mereka tetap aman adalah
 * kebiasaan, dan kebiasaan tidak menggagalkan build. Test ini yang menggagalkannya.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, act, waitFor } from '@testing-library/react'
import { ConversationList } from '@/components/inbox/ConversationList'
import { ThreadView } from '@/components/inbox/ThreadView'
import { NotificationListener } from '@/components/NotificationListener'

class FakeEventSource {
  static instances: FakeEventSource[] = []
  onmessage: ((event: MessageEvent) => void) | null = null
  close = vi.fn()
  constructor() {
    FakeEventSource.instances.push(this)
  }
  emit(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) } as MessageEvent)
  }
}

// Bentuk persis seperti yang disiarkan `src/lib/pipeline/tracer.ts`.
const PIPELINE_EVENT = {
  type: 'pipeline.step',
  runId: '5b1f0d2c-0000-4000-8000-000000000000',
  conversationId: 'conv_1',
  stepId: 'pahami-kebutuhan',
  status: 'mulai',
  at: '2026-09-08T04:00:00.000Z',
  detail: { alasan: 'contoh' },
}

const conversationRows = [
  {
    id: 'conv_1',
    contactName: 'Bruno',
    contactPhone: '6281234567890',
    avatarUrl: null,
    lastMessage: 'halo',
    lastMessageSentBy: 'CUSTOMER',
    lastMessageAt: new Date('2026-09-08T03:00:00.000Z').toISOString(),
    unreadCount: 0,
    botEnabled: true,
    isPinned: false,
    isTest: false,
    status: 'OPEN',
    labels: [],
  },
]

const threadMessages = [
  {
    id: 'msg_1',
    conversationId: 'conv_1',
    direction: 'INBOUND',
    type: 'text',
    content: 'Halo dari pelanggan',
    sentBy: 'CUSTOMER',
    deliveryStatus: 'DELIVERED',
    channel: 'OFFICIAL',
    createdAt: new Date('2026-09-08T03:00:00.000Z').toISOString(),
    botTrace: null,
  },
]

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: () => Promise.resolve(body) } as Response
}

beforeEach(() => {
  FakeEventSource.instances = []
  vi.stubGlobal('EventSource', FakeEventSource)
  vi.stubGlobal('location', { pathname: '/inbox', href: 'http://localhost/inbox' })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('konsumen SSE lama terhadap event pipeline.step', () => {
  it('ConversationList mengabaikannya: tidak melempar, tidak memuat ulang daftar, baris tidak berubah', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse(conversationRows))))
    render(<ConversationList selectedId={null} onSelect={() => {}} />)
    await waitFor(() => expect(screen.getByText('Bruno')).toBeInTheDocument())
    vi.mocked(fetch).mockClear()

    const es = FakeEventSource.instances.at(-1)!
    act(() => {
      es.emit(PIPELINE_EVENT)
    })

    // Kalau penyaringan `event.type` hilang, `conversationId` yang tidak dikenal akan memicu
    // pemuatan ulang daftar -- persis cabang "known === false" di ConversationList.
    expect(fetch).not.toHaveBeenCalled()
    expect(screen.getByText('halo')).toBeInTheDocument()
  })

  it('ThreadView mengabaikannya: tidak melempar dan tidak menyentuh daftar pesan', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: RequestInfo | URL) => {
        const s = String(url)
        if (s.endsWith('/messages')) return Promise.resolve(jsonResponse(threadMessages))
        if (s.endsWith('/api/accounts')) return Promise.resolve(jsonResponse([]))
        return Promise.resolve(jsonResponse({ botEnabled: true }))
      })
    )
    render(<ThreadView conversationId="conv_1" />)
    await waitFor(() => expect(screen.getByText('Halo dari pelanggan')).toBeInTheDocument())

    const es = FakeEventSource.instances.at(-1)!
    act(() => {
      es.emit(PIPELINE_EVENT)
    })

    expect(screen.getByText('Halo dari pelanggan')).toBeInTheDocument()
    // `handoff.alert` mematikan tombol "Ambil Alih dari Bot"; sebuah event tak dikenal tidak boleh.
    expect(screen.getByText('Ambil Alih dari Bot')).toBeInTheDocument()
  })

  it('NotificationListener mengabaikannya: tidak ada bunyi dan tidak ada notifikasi desktop', () => {
    const play = vi.fn(() => Promise.resolve())
    vi.stubGlobal('Audio', class { play = play })
    const NotificationSpy = vi.fn()
    vi.stubGlobal(
      'Notification',
      Object.assign(NotificationSpy, { permission: 'granted', requestPermission: vi.fn() })
    )
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse([]))))

    render(<NotificationListener />)
    const es = FakeEventSource.instances.at(-1)!

    expect(() =>
      act(() => {
        es.emit(PIPELINE_EVENT)
      })
    ).not.toThrow()
    expect(play).not.toHaveBeenCalled()
    expect(NotificationSpy).not.toHaveBeenCalled()
  })

  it('event yang benar-benar tidak dikenal pun tidak menjatuhkan konsumen mana pun', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse(conversationRows))))
    render(<ConversationList selectedId={null} onSelect={() => {}} />)
    await waitFor(() => expect(screen.getByText('Bruno')).toBeInTheDocument())

    const es = FakeEventSource.instances.at(-1)!
    expect(() =>
      act(() => {
        es.emit({ type: 'sesuatu.yang.belum.ada', conversationId: 'conv_1' })
      })
    ).not.toThrow()
  })
})
