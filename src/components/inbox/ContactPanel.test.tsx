import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import { ContactPanel } from './ContactPanel'

const baseDetail = {
  botEnabled: true,
  contactId: 'contact_1',
  contactName: 'Bruno Figarola',
  avatarUrl: null as string | null,
  source: 'Instagram',
  bookingData: null as unknown,
  tripBrief: null as unknown,
  labels: [{ id: 'lbl_1', name: 'Confirmed Booking', color: '#3C6B42' }],
  pipelineStage: 'new',
}

const allLabels = [
  { id: 'lbl_1', name: 'Confirmed Booking', color: '#3C6B42' },
  { id: 'lbl_2', name: 'New Customer', color: '#106877' },
]

function mockFetchWith(detail: typeof baseDetail) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      if (url === '/api/labels') return Promise.resolve({ ok: true, json: () => Promise.resolve(allLabels) } as Response)
      if (url === `/api/contacts/${detail.contactId}/notes`) return Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response)
      if (url === `/api/contacts/${detail.contactId}/reminders`) return Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response)
      return Promise.resolve({ ok: true, json: () => Promise.resolve(detail) } as Response)
    })
  )
}

function mockFetchWithPipeline(detail: typeof baseDetail, pipelineResponse: { ok: boolean; json: () => Promise<unknown> }) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      if (url === '/api/labels') return Promise.resolve({ ok: true, json: () => Promise.resolve(allLabels) } as Response)
      if (url === `/api/contacts/${detail.contactId}/notes`) return Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response)
      if (url === `/api/contacts/${detail.contactId}/reminders`) return Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response)
      if (url === `/api/conversations/conv_1/pipeline`) return Promise.resolve(pipelineResponse as Response)
      return Promise.resolve({ ok: true, json: () => Promise.resolve(detail) } as Response)
    })
  )
}

// Tab terakhir diingat di localStorage; tiap test mulai dari tab bawaan (Booking).
beforeEach(() => {
  localStorage.clear()
})

/** Detail kontak sudah dimuat: kolom tidak lagi aria-busy. */
async function waitForDetail() {
  await waitFor(() => expect(screen.getByRole('region', { name: 'Info kontak' })).not.toHaveAttribute('aria-busy'))
}

/** Nama, pipeline, label, dan info platform tinggal di tab Kontak. */
async function openKontakTab() {
  await waitForDetail()
  fireEvent.click(screen.getByRole('tab', { name: 'Kontak' }))
}

describe('ContactPanel', () => {
  it('renders contact name and source in the Kontak tab', async () => {
    mockFetchWith(baseDetail)
    render(<ContactPanel conversationId="conv_1" />)

    await openKontakTab()
    expect(screen.getByText('Bruno Figarola')).toBeInTheDocument()
    expect(screen.getByText('Instagram')).toBeInTheDocument()
  })

  it('shows a verified "Booking Ada" summary when bookingData is present (Mode 3)', async () => {
    // Real booking-API shape (see src/lib/booking/client.ts) — the client passes the
    // upstream JVTO payload through unmapped, so there is no destination/pax/status.
    mockFetchWith({
      ...baseDetail,
      bookingData: {
        id: 'B1',
        guest: 'Bruno Figarola',
        package: 'Bromo Sunrise Tour',
        date: { start: '10 Aug 2026', end: '12 Aug 2026', start_ymd: '2026-08-10', end_ymd: '2026-08-12' },
        orderChannel: 'JVTO',
        total_pax: 2,
        financial: { payment: 500000, balance: 500000 },
      },
      tripBrief: { destination: 'Ignored', pax: 99 },
    })
    render(<ContactPanel conversationId="conv_1" />)

    await screen.findByText('Booking Ada')
    expect(screen.getByText('Bromo Sunrise Tour')).toBeInTheDocument()
    expect(screen.getByText('10 Aug 2026 – 12 Aug 2026')).toBeInTheDocument()
    expect(screen.getByText('Belum lunas')).toBeInTheDocument()
    expect(screen.queryByText('Info dari percakapan (belum booking)')).not.toBeInTheDocument()
  })

  it('shows a "Info dari percakapan (belum booking)" summary when only tripBrief is set (Mode 1/2)', async () => {
    mockFetchWith({ ...baseDetail, bookingData: null, tripBrief: { destination: 'Bali', pax: 4 } })
    render(<ContactPanel conversationId="conv_1" />)

    await screen.findByText('Info dari percakapan (belum booking)')
    expect(screen.getByText('Bali')).toBeInTheDocument()
    expect(screen.queryByText('Booking Ada')).not.toBeInTheDocument()
  })

  it('shows a neutral empty state for a brand-new conversation with neither bookingData nor tripBrief', async () => {
    mockFetchWith({ ...baseDetail, bookingData: null, tripBrief: null })
    render(<ContactPanel conversationId="conv_1" />)

    await waitForDetail()
    expect(screen.queryByText('Booking Ada')).not.toBeInTheDocument()
    expect(screen.queryByText('Info dari percakapan (belum booking)')).not.toBeInTheDocument()
    expect(screen.getByText('Belum ada data booking atau brief perjalanan.')).toBeInTheDocument()
  })

  it('renders the conversation labels', async () => {
    mockFetchWith(baseDetail)
    render(<ContactPanel conversationId="conv_1" />)

    await openKontakTab()
    await screen.findByText('Confirmed Booking')
  })

  it('fetches notes for the contact (using contactId, not conversationId) and renders the notes section', async () => {
    mockFetchWith(baseDetail)
    render(<ContactPanel conversationId="conv_1" />)

    await screen.findByText('Catatan')
    await screen.findByText('Belum ada catatan.')
    expect(fetch).toHaveBeenCalledWith('/api/contacts/contact_1/notes')
  })

  it('fetches reminders for the contact (using contactId, not conversationId) and renders the reminders section', async () => {
    mockFetchWith(baseDetail)
    render(<ContactPanel conversationId="conv_1" />)

    await screen.findByText('Reminder')
    await screen.findByText('Belum ada reminder.')
    expect(fetch).toHaveBeenCalledWith('/api/contacts/contact_1/reminders')
  })

  it('shows the pipeline stage dropdown pre-selected to the server-provided stage', async () => {
    mockFetchWith({ ...baseDetail, pipelineStage: 'nego' })
    render(<ContactPanel conversationId="conv_1" />)

    await openKontakTab()
    expect(screen.getByLabelText('Tahap pipeline')).toHaveValue('nego')
  })

  it('PATCHes the new pipeline stage on change, only updating the displayed value once the server confirms', async () => {
    mockFetchWithPipeline(baseDetail, { ok: true, json: () => Promise.resolve({ pipelineStage: 'booked' }) })
    render(<ContactPanel conversationId="conv_1" />)

    await openKontakTab()
    expect(screen.getByLabelText('Tahap pipeline')).toHaveValue('new')

    fireEvent.change(screen.getByLabelText('Tahap pipeline'), { target: { value: 'booked' } })

    expect(fetch).toHaveBeenCalledWith('/api/conversations/conv_1/pipeline', {
      method: 'PATCH',
      body: JSON.stringify({ stage: 'booked' }),
    })
    await waitFor(() => expect(screen.getByLabelText('Tahap pipeline')).toHaveValue('booked'))
  })

  it('does not change the displayed pipeline stage when the PATCH responds non-ok, and shows an error', async () => {
    mockFetchWithPipeline(baseDetail, { ok: false, json: () => Promise.resolve({ error: 'nope' }) })
    render(<ContactPanel conversationId="conv_1" />)

    await openKontakTab()

    fireEvent.change(screen.getByLabelText('Tahap pipeline'), { target: { value: 'booked' } })

    await waitFor(() => expect(screen.getByText('Gagal mengubah status pipeline')).toBeInTheDocument())
    expect(screen.getByLabelText('Tahap pipeline')).toHaveValue('new')
  })

  it('does not change the displayed pipeline stage when the PATCH request itself rejects (network failure)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url === '/api/labels') return Promise.resolve({ ok: true, json: () => Promise.resolve(allLabels) } as Response)
        if (url === `/api/contacts/${baseDetail.contactId}/notes`) return Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response)
        if (url === `/api/contacts/${baseDetail.contactId}/reminders`) return Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response)
        if (url === '/api/conversations/conv_1/pipeline') return Promise.reject(new Error('network down'))
        return Promise.resolve({ ok: true, json: () => Promise.resolve(baseDetail) } as Response)
      })
    )
    render(<ContactPanel conversationId="conv_1" />)

    await openKontakTab()

    fireEvent.change(screen.getByLabelText('Tahap pipeline'), { target: { value: 'booked' } })

    await waitFor(() => expect(screen.getByText('Gagal mengubah status pipeline')).toBeInTheDocument())
    expect(screen.getByLabelText('Tahap pipeline')).toHaveValue('new')
  })
})

// Tahap 1C. Panel kanan: nama kolom, keadaan memuat, dan gulungan sendiri.
describe('ContactPanel — kolom, memuat, dan gulungan', () => {
  it('menandai kolom sibuk selagi detail kontak dimuat, dengan tab tetap tampil', () => {
    // Sengaja tidak pernah selesai: inilah jendela waktu yang sedang diuji.
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    render(<ContactPanel conversationId="conv_1" />)

    const column = screen.getByRole('region', { name: 'Info kontak' })
    expect(column).toHaveAttribute('aria-busy', 'true')
    expect(screen.getAllByRole('tab')).toHaveLength(3)
    expect(screen.getByText('Memuat…')).toBeInTheDocument()
  })

  it('memberi kolomnya nama dan menggulung di dalam dirinya sendiri', async () => {
    mockFetchWith(baseDetail)
    const { container } = render(<ContactPanel conversationId="conv_1" />)
    await waitForDetail()

    const column = container.firstElementChild as HTMLElement
    expect(column).toHaveAttribute('aria-label', 'Info kontak')
    expect(column).toHaveClass('col')
    // Isi yang menggulung sendiri ada di .pan (gaya di new.css), di dalam kolom.
    expect(column.querySelector('.pan')).toBe(screen.getByRole('tabpanel'))
  })
})

describe('ContactPanel — info kontak di platform asal', () => {
  function mockFetchWithChannel(contact: unknown) {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url === '/api/conversations/conv_1/channel') return Promise.resolve({ ok: true, json: () => Promise.resolve({ contact }) } as Response)
        if (url === '/api/labels') return Promise.resolve({ ok: true, json: () => Promise.resolve(allLabels) } as Response)
        if (url.startsWith('/api/contacts/')) return Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response)
        return Promise.resolve({ ok: true, json: () => Promise.resolve(baseDetail) } as Response)
      })
    )
  }

  it('menampilkan @username Instagram sebagai tautan yang terbuka di tab baru', async () => {
    mockFetchWithChannel({
      platform: 'INSTAGRAM', platformLabel: 'Instagram', value: '@sinta.jvto',
      href: 'https://www.instagram.com/sinta.jvto/', linkLabel: 'Buka profil Instagram',
    })
    render(<ContactPanel conversationId="conv_1" />)
    await openKontakTab()

    const link = await screen.findByRole('link', { name: '@sinta.jvto' })
    expect(link).toHaveAttribute('href', 'https://www.instagram.com/sinta.jvto/')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
    expect(screen.getByText('Platform').nextElementSibling).toHaveTextContent('Instagram')
  })

  it('nilai tanpa tautan tampil sebagai teks biasa', async () => {
    mockFetchWithChannel({ platform: 'FACEBOOK', platformLabel: 'Facebook', value: 'David', href: null, linkLabel: null })
    render(<ContactPanel conversationId="conv_1" />)
    await openKontakTab()

    const value = await screen.findByText('David')
    expect(value.tagName).toBe('DD')
    expect(within(value).queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getByText('Platform').nextElementSibling).toHaveTextContent('Facebook')
  })

  it('tanpa info kontak (respons kosong) bagian ini tidak tampil, panel tetap jalan', async () => {
    mockFetchWithChannel(null)
    render(<ContactPanel conversationId="conv_1" />)
    await openKontakTab()

    expect(screen.getByText('Bruno Figarola')).toBeInTheDocument()
    expect(screen.queryByText('Platform')).not.toBeInTheDocument()
  })
})

describe('ContactPanel — tab Booking / Ringkasan / Kontak', () => {
  const chatReview = {
    latest: null,
    item: { id: 'item_1', kind: 'FOLLOW_UP', state: 'OPEN', anchorAt: '2026-10-18T13:30:00.000Z', dueAt: null, closedReason: null, note: null, closedAt: null },
    history: [], pinned: [], changeHistory: [],
  }

  function mockFetchWithChatReview() {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url === '/api/conversations/conv_1/chat-review') return Promise.resolve({ ok: true, json: () => Promise.resolve(chatReview) } as Response)
        if (url === '/api/labels') return Promise.resolve({ ok: true, json: () => Promise.resolve(allLabels) } as Response)
        if (url.startsWith('/api/contacts/')) return Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response)
        return Promise.resolve({ ok: true, json: () => Promise.resolve(baseDetail) } as Response)
      })
    )
  }

  it('mulai di tab Booking, dan belum memuat ringkasan', async () => {
    mockFetchWithChatReview()
    render(<ContactPanel conversationId="conv_1" />)

    await waitForDetail()
    expect(screen.getByRole('tab', { name: 'Booking' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Ringkasan' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('tab', { name: 'Kontak' })).toHaveAttribute('aria-selected', 'false')
    expect(await within(screen.getByRole('tabpanel', { name: 'Booking' })).findByText('Catatan')).toBeInTheDocument()
    expect(screen.queryByLabelText('Tahap pipeline')).not.toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalledWith('/api/conversations/conv_1/chat-review')
  })

  it('berpindah ke Ringkasan lalu ke Kontak, isi tiap tab tampil di tabnya', async () => {
    mockFetchWithChatReview()
    render(<ContactPanel conversationId="conv_1" />)
    await waitForDetail()

    fireEvent.click(screen.getByRole('tab', { name: 'Ringkasan' }))
    expect(screen.getByRole('tab', { name: 'Ringkasan' })).toHaveAttribute('aria-selected', 'true')
    const panel = screen.getByRole('tabpanel', { name: 'Ringkasan' })
    expect(await within(panel).findByText('Perlu follow up')).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledWith('/api/conversations/conv_1/chat-review')
    expect(screen.queryByLabelText('Tahap pipeline')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'Kontak' }))
    const kontak = screen.getByRole('tabpanel', { name: 'Kontak' })
    expect(within(kontak).getByText('Bruno Figarola')).toBeInTheDocument()
    expect(within(kontak).getByLabelText('Tahap pipeline')).toHaveValue('new')
    expect(screen.queryByRole('tabpanel', { name: 'Ringkasan' })).not.toBeInTheDocument()
  })

  it('tab terakhir diingat untuk panel berikutnya', async () => {
    mockFetchWithChatReview()
    const { unmount } = render(<ContactPanel conversationId="conv_1" />)
    await waitForDetail()
    fireEvent.click(screen.getByRole('tab', { name: 'Ringkasan' }))
    unmount()

    render(<ContactPanel conversationId="conv_1" />)
    expect(await screen.findByRole('tab', { name: 'Ringkasan' })).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByText('Perlu follow up')).toBeInTheDocument()
  })

  it('localStorage yang melempar tidak memecah panel: tab tetap berpindah', async () => {
    mockFetchWithChatReview()
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    try {
      render(<ContactPanel conversationId="conv_1" />)
      await waitForDetail()
      expect(screen.getByRole('tab', { name: 'Booking' })).toHaveAttribute('aria-selected', 'true')
      fireEvent.click(screen.getByRole('tab', { name: 'Ringkasan' }))
      expect(screen.getByRole('tab', { name: 'Ringkasan' })).toHaveAttribute('aria-selected', 'true')
    } finally {
      getItem.mockRestore()
      setItem.mockRestore()
    }
  })
})
