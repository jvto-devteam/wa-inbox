import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MarqueeText } from './marquee-text'

afterEach(cleanup)

describe('MarqueeText', () => {
  it('renders the text', () => {
    render(<MarqueeText text="Muhammad Zayar" />)
    expect(screen.getByText('Muhammad Zayar')).toBeInTheDocument()
  })

  it('always carries the full text in a title attribute, so hovering with no JS overflow logic still works', () => {
    render(<MarqueeText text="Muhammad Zayar bin Abdullah yang sangat panjang sekali" />)
    expect(screen.getByTitle('Muhammad Zayar bin Abdullah yang sangat panjang sekali')).toBeInTheDocument()
  })

  it('passes through the caller-provided className onto the rendered text', () => {
    render(<MarqueeText text="Zayar" className="text-base font-semibold text-ink" />)
    expect(screen.getByText('Zayar')).toHaveClass('text-base', 'font-semibold', 'text-ink')
  })
})
