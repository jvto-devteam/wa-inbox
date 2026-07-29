import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TemplatePreviewBubble } from './TemplatePreviewBubble'

describe('TemplatePreviewBubble', () => {
  it('renders the template name and body', () => {
    render(<TemplatePreviewBubble template={{ name: 'sapaan', body: 'Halo, ada yang bisa dibantu?', format: 'TEXT' }} />)
    expect(screen.getByText('sapaan')).toBeInTheDocument()
    expect(screen.getByText('Halo, ada yang bisa dibantu?')).toBeInTheDocument()
  })

  it('calls onClick when the bubble is clicked', () => {
    const onClick = vi.fn()
    render(<TemplatePreviewBubble template={{ name: 'sapaan', body: 'Halo', format: 'TEXT' }} onClick={onClick} />)
    fireEvent.click(screen.getByText('sapaan'))
    expect(onClick).toHaveBeenCalled()
  })

  it('shows the LTO offer banner', () => {
    render(<TemplatePreviewBubble template={{ name: 'promo', body: 'Diskon spesial!', format: 'LTO', offerTitle: 'Diskon 25%' }} />)
    expect(screen.getByText(/Diskon 25%/)).toBeInTheDocument()
  })

  it('shows the coupon button label', () => {
    render(<TemplatePreviewBubble template={{ name: 'kupon', body: 'Gunakan kode ini', format: 'COUPON', couponButtonText: 'Salin Kode' }} />)
    expect(screen.getByText(/Salin Kode/)).toBeInTheDocument()
  })

  it('shows carousel card thumbnails using their real media URL', () => {
    render(
      <TemplatePreviewBubble
        template={{
          name: 'katalog', body: 'Rekomendasi paket', format: 'CAROUSEL',
          cards: [{ mediaType: 'IMAGE', mediaUrl: 'https://example.com/ijen.jpg', bodyText: 'Ijen', buttons: [] }],
        }}
      />
    )
    expect(screen.getByAltText('Ijen')).toHaveAttribute('src', 'https://example.com/ijen.jpg')
  })

  it('shows a TEXT header above the body', () => {
    render(
      <TemplatePreviewBubble
        template={{ name: 'sapaan', body: 'Halo!', format: 'TEXT', header: { type: 'TEXT', text: 'Selamat Datang' } }}
      />
    )
    expect(screen.getByText('Selamat Datang')).toBeInTheDocument()
  })

  it('shows a media header image using its real URL', () => {
    render(
      <TemplatePreviewBubble
        template={{
          name: 'promo', body: 'Halo!', format: 'TEXT',
          header: { type: 'IMAGE', mediaUrl: 'https://example.com/banner.jpg' },
        }}
      />
    )
    expect(document.querySelector('img[src="https://example.com/banner.jpg"]')).toBeInTheDocument()
  })

  it('shows the footer text below the body', () => {
    render(<TemplatePreviewBubble template={{ name: 'sapaan', body: 'Halo!', format: 'TEXT', footer: 'JVTO Tour' }} />)
    expect(screen.getByText('JVTO Tour')).toBeInTheDocument()
  })

  it('shows up to 3 button rows with type-specific icons', () => {
    render(
      <TemplatePreviewBubble
        template={{
          name: 'promo', body: 'Halo', format: 'LTO', offerTitle: 'Promo',
          buttons: [
            { type: 'URL', text: 'Lihat Promo', url: 'https://example.com' },
            { type: 'PHONE_NUMBER', text: 'Telepon Kami', phoneNumber: '+62' },
          ],
        }}
      />
    )
    expect(screen.getByText(/🔗.*Lihat Promo/)).toBeInTheDocument()
    expect(screen.getByText(/📞.*Telepon Kami/)).toBeInTheDocument()
  })
})
