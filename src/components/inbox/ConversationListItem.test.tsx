import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { Platform } from '@prisma/client'
import { ConversationListItem, formatListTime } from './ConversationListItem'

const summary = {
  id: 'conv_1', contactName: 'Bruno Figarola', contactPhone: '6281234567890', avatarUrl: null,
  lastMessage: 'Halo!', lastMessageSentBy: 'CUSTOMER', lastMessageAt: new Date().toISOString(),
  botEnabled: true, status: 'OPEN', isPinned: false, platform: null as Platform | null,
  orderChannel: null, pipelineStage: 'new', unreadCount: 0,
  labels: [{ id: 'lbl_1', name: 'Confirmed Booking', color: '#3C6B42' }],
  bookingGuestName: null as string | null,
}

describe('ConversationListItem', () => {
  it('shows contact name, last message, and labels', () => {
    render(<ConversationListItem conversation={summary} onClick={() => {}} />)
    expect(screen.getByText('Bruno Figarola')).toBeInTheDocument()
    expect(screen.getByText('Halo!')).toBeInTheDocument()
    expect(screen.getByText('Confirmed Booking')).toBeInTheDocument()
  })

  it('shows a clear handoff placeholder instead of a blank preview for a logged handoff decision', () => {
    // Task 34 logs a handoff decision as a Message row with content: null, sentBy: 'BOT'. Without
    // a placeholder, the sidebar preview line would render blank instead of signaling a handoff.
    render(
      <ConversationListItem
        conversation={{ ...summary, lastMessage: null, lastMessageSentBy: 'BOT' }}
        onClick={() => {}}
      />
    )
    expect(screen.getByText('Bot menyerahkan ke agen')).toBeInTheDocument()
  })

  it('shows an unread badge and bolds the row when unreadCount is greater than zero', () => {
    render(<ConversationListItem conversation={{ ...summary, unreadCount: 3 }} onClick={() => {}} />)
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByLabelText('3 pesan belum dibaca')).toBeInTheDocument()
  })

  it('shows no unread badge when unreadCount is zero', () => {
    render(<ConversationListItem conversation={summary} onClick={() => {}} />)
    expect(screen.queryByLabelText(/pesan belum dibaca/)).not.toBeInTheDocument()
  })

  it('shows a pin indicator when isPinned is true, and none when false', () => {
    const { rerender } = render(<ConversationListItem conversation={{ ...summary, isPinned: true }} onClick={() => {}} />)
    expect(screen.getByLabelText('Disematkan')).toBeInTheDocument()

    rerender(<ConversationListItem conversation={summary} onClick={() => {}} />)
    expect(screen.queryByLabelText('Disematkan')).not.toBeInTheDocument()
  })

  it('shows the order channel badge when a booking exists', () => {
    render(<ConversationListItem conversation={{ ...summary, orderChannel: 'KLOOK' }} onClick={() => {}} />)
    expect(screen.getByText('KLOOK')).toBeInTheDocument()
  })

  it('colors the KLOOK badge orange and the JVTO badge blue', () => {
    const { rerender } = render(<ConversationListItem conversation={{ ...summary, orderChannel: 'KLOOK' }} onClick={() => {}} />)
    expect(screen.getByText('KLOOK')).toHaveClass('bg-orange-50', 'text-orange-700')

    rerender(<ConversationListItem conversation={{ ...summary, orderChannel: 'JVTO' }} onClick={() => {}} />)
    expect(screen.getByText('JVTO')).toHaveClass('bg-blue-50', 'text-blue-700')
  })

  it('shows no order channel badge at all when there is no booking yet', () => {
    render(<ConversationListItem conversation={summary} onClick={() => {}} />)
    expect(screen.queryByText('KLOOK')).not.toBeInTheDocument()
    expect(screen.queryByText('JVTO')).not.toBeInTheDocument()
  })

  it('shows the pipeline stage badge, translated to its Indonesian label', () => {
    render(<ConversationListItem conversation={{ ...summary, pipelineStage: 'nego' }} onClick={() => {}} />)
    expect(screen.getByText('Negosiasi')).toBeInTheDocument()
  })

  it('always shows a pipeline stage badge, even for the default "new" stage', () => {
    render(<ConversationListItem conversation={summary} onClick={() => {}} />)
    expect(screen.getByText('Baru')).toBeInTheDocument()
  })

  it('shows the order channel badge and the pipeline stage badge together without either being dropped', () => {
    render(<ConversationListItem conversation={{ ...summary, orderChannel: 'JVTO', pipelineStage: 'lunas' }} onClick={() => {}} />)
    expect(screen.getByText('JVTO')).toBeInTheDocument()
    expect(screen.getByText('Lunas')).toBeInTheDocument()
  })

  it('shows the platform badge when showPlatformBadge is true and the conversation has a platform', () => {
    render(
      <ConversationListItem
        conversation={{ ...summary, platform: 'WHATSAPP' }}
        onClick={() => {}}
        showPlatformBadge
      />
    )
    expect(screen.getByText('WhatsApp')).toBeInTheDocument()
  })

  it('hides the platform badge when showPlatformBadge is false, even with a platform set', () => {
    render(<ConversationListItem conversation={{ ...summary, platform: 'FACEBOOK' }} onClick={() => {}} />)
    expect(screen.queryByText('Facebook')).not.toBeInTheDocument()
  })

  it('hides the platform badge when there is no channelIdentity, even on the "Semua" tab', () => {
    render(<ConversationListItem conversation={{ ...summary, platform: null }} onClick={() => {}} showPlatformBadge />)
    expect(screen.queryByText('WhatsApp')).not.toBeInTheDocument()
    expect(screen.queryByText('Facebook')).not.toBeInTheDocument()
  })

  // Batasan keras dari review: badge platform tidak boleh bisa dikira badge orderChannel --
  // yang satu asal booking (JVTO/KLOOK), yang satu platform pesan (WhatsApp/Facebook). Keduanya
  // harus bisa tampil bersamaan di baris yang sama, dan rupanya harus berbeda.
  it('shows the platform badge and the order channel badge together, visually distinct from each other', () => {
    render(
      <ConversationListItem
        conversation={{ ...summary, platform: 'FACEBOOK', orderChannel: 'KLOOK' }}
        onClick={() => {}}
        showPlatformBadge
      />
    )
    const platformBadge = screen.getByText('Facebook')
    const orderChannelBadge = screen.getByText('KLOOK')
    expect(platformBadge).toBeInTheDocument()
    expect(orderChannelBadge).toBeInTheDocument()
    // Different visual treatment (accent-colored badge vs. the muted+per-channel-color badge),
    // not merely different text -- so the two facts can't be mistaken for one another.
    expect(platformBadge.className).not.toBe(orderChannelBadge.className)
  })

  it('shows the booking guest name next to the contact name when it differs', () => {
    render(
      <ConversationListItem
        conversation={{ ...summary, contactName: 'Zayar', bookingGuestName: 'Muhammad Zayar' }}
        onClick={() => {}}
      />
    )
    expect(screen.getByText('Zayar (Muhammad Zayar)')).toBeInTheDocument()
  })

  it('shows only the contact name when there is no booking guest name', () => {
    render(<ConversationListItem conversation={summary} onClick={() => {}} />)
    expect(screen.getByText('Bruno Figarola')).toBeInTheDocument()
  })

  it('shows the real avatar photo when avatarUrl is set, instead of the initial fallback', () => {
    render(<ConversationListItem conversation={{ ...summary, avatarUrl: 'https://x.test/photo.jpg' }} onClick={() => {}} />)
    expect(screen.getByAltText('Bruno Figarola')).toBeInTheDocument()
    expect(screen.queryByText('B')).not.toBeInTheDocument()
  })

  it('shows an initial-letter avatar when there is no avatarUrl', () => {
    render(<ConversationListItem conversation={summary} onClick={() => {}} />)
    expect(screen.getByText('B')).toBeInTheDocument()
  })
})

// Tahap 1C: hierarki satu baris. Yang diuji di sini adalah apa yang harus bisa DIPINDAI
// sekilas -- nama, cuplikan, waktu, belum-dibaca, label, dan status bot -- bukan rupanya.
describe('ConversationListItem — hierarki satu baris', () => {
  it('menandai baris yang sedang dibuka dengan aria-current, bukan hanya dengan warna latar', () => {
    const { rerender } = render(<ConversationListItem conversation={summary} onClick={() => {}} active />)
    expect(screen.getByRole('button')).toHaveAttribute('aria-current', 'true')

    rerender(<ConversationListItem conversation={summary} onClick={() => {}} />)
    expect(screen.getByRole('button')).not.toHaveAttribute('aria-current')
  })

  it('menunjukkan waktu pesan terakhir sebagai <time> yang bisa dibaca mesin', () => {
    render(<ConversationListItem conversation={summary} onClick={() => {}} />)

    const time = document.querySelector('time')
    expect(time).toBeInTheDocument()
    expect(time).toHaveAttribute('dateTime', summary.lastMessageAt)
    expect(time?.textContent).not.toBe('')
  })

  it('menandai bot aktif dan bot mati, dua-duanya dengan nama yang terbaca', () => {
    const { rerender } = render(<ConversationListItem conversation={summary} onClick={() => {}} />)
    expect(screen.getByLabelText('Bot aktif')).toBeInTheDocument()

    rerender(<ConversationListItem conversation={{ ...summary, botEnabled: false }} onClick={() => {}} />)
    expect(screen.getByLabelText('Bot mati')).toBeInTheDocument()
    expect(screen.queryByLabelText('Bot aktif')).not.toBeInTheDocument()
  })

  it('menyebut siapa yang bicara terakhir kalau itu bukan pelanggan', () => {
    const { rerender } = render(
      <ConversationListItem
        conversation={{ ...summary, lastMessage: 'Sudah saya cek ya', lastMessageSentBy: 'AGENT' }}
        onClick={() => {}}
      />
    )
    expect(screen.getByText('Agen:')).toBeInTheDocument()

    // Pelanggan adalah suara bawaan sebuah inbox; menuliskannya di setiap baris hanya tinta.
    rerender(<ConversationListItem conversation={summary} onClick={() => {}} />)
    expect(screen.queryByText('Pelanggan:')).not.toBeInTheDocument()
  })

  it('mengatakan "belum ada pesan" alih-alih meninggalkan baris cuplikan kosong', () => {
    render(
      <ConversationListItem
        conversation={{ ...summary, lastMessage: null, lastMessageSentBy: 'CUSTOMER' }}
        onClick={() => {}}
      />
    )
    expect(screen.getByText('Belum ada pesan')).toBeInTheDocument()
  })

  it('memakai avatar netral di daftar, bukan salah satu dari delapan rona deterministik', () => {
    // Keputusan Tahap 1C: rona per-nama menolong di panel kontak (satu avatar, jangkar
    // identitas) dan merugikan di daftar rapat, tempat ia melawan penanda belum dibaca.
    render(<ConversationListItem conversation={summary} onClick={() => {}} />)

    const initial = screen.getByText('B')
    expect(initial).toHaveClass('bg-surface-sunken')
    expect(initial.className).not.toMatch(/bg-\[#/)
  })
})

describe('formatListTime', () => {
  const now = new Date('2026-07-20T15:00:00.000Z')

  it('memberi jam untuk pesan hari ini', () => {
    expect(formatListTime('2026-07-20T09:30:00.000Z', now)).toMatch(/^\d{2}[.:]\d{2}$/)
  })

  it('memberi "Kemarin" untuk pesan kemarin, bukan jam yang menyesatkan', () => {
    expect(formatListTime('2026-07-19T09:30:00.000Z', now)).toBe('Kemarin')
  })

  it('memberi nama hari untuk minggu ini', () => {
    // Tiga hari lalu: cukup dekat untuk dikenali sebagai hari, terlalu jauh untuk sekadar jam.
    const label = formatListTime('2026-07-17T09:30:00.000Z', now)
    expect(label).not.toBe('Kemarin')
    expect(label).not.toMatch(/\d{2}\/\d{2}\/\d{2}/)
  })

  it('memberi tanggal pendek untuk yang lebih lama dari seminggu', () => {
    expect(formatListTime('2026-05-02T09:30:00.000Z', now)).toMatch(/\d{2}\/\d{2}\/\d{2}/)
  })

  it('tidak melempar dan tidak menuliskan "Invalid Date" untuk timestamp rusak', () => {
    expect(formatListTime('bukan tanggal', now)).toBe('')
  })
})
