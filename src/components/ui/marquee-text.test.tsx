import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { MarqueeText } from './marquee-text'

afterEach(cleanup)

// jsdom never actually lays anything out, so scrollWidth/clientWidth are always 0 -- stub
// them directly on the measured element to simulate text that overflows its container.
function stubOverflow(el: Element, scrollWidth: number, clientWidth: number) {
  Object.defineProperty(el, 'scrollWidth', { value: scrollWidth, configurable: true })
  Object.defineProperty(el, 'clientWidth', { value: clientWidth, configurable: true })
}

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

// Regression: MarqueeText's own onFocus/onBlur were dead code in every real usage --
// ConversationListItem nests it inside the row's <button>, so keyboard focus lands on the
// button (focusin/focusout bubble UP from there, never back DOWN into this descendant span)
// and the span's own onFocus never fired. ThreadView/ContactPanel have no focusable ancestor
// at all. MarqueeText must instead find the nearest interactive ancestor itself and listen
// on IT directly.
describe('MarqueeText — hover starts and stops the scroll', () => {
  it('applies the scrolling animation class on mouseenter when the text overflows its container', () => {
    render(<MarqueeText text="Nama yang sangat panjang sekali sehingga pasti terpotong" />)
    const textEl = screen.getByTitle('Nama yang sangat panjang sekali sehingga pasti terpotong')
    stubOverflow(textEl, 300, 100)

    fireEvent.mouseEnter(textEl.parentElement as HTMLElement)
    expect(textEl).toHaveClass('animate-marquee')

    fireEvent.mouseLeave(textEl.parentElement as HTMLElement)
    expect(textEl).not.toHaveClass('animate-marquee')
  })

  it('does not start scrolling on hover when the text fits (no overflow)', () => {
    render(<MarqueeText text="Zayar" />)
    const textEl = screen.getByTitle('Zayar')
    stubOverflow(textEl, 50, 100)

    fireEvent.mouseEnter(textEl.parentElement as HTMLElement)
    expect(textEl).not.toHaveClass('animate-marquee')
  })
})

describe('MarqueeText — keyboard focus on the nearest interactive ancestor', () => {
  it('starts scrolling when a real <button> ancestor receives focus, and resets when it loses focus', () => {
    render(
      <button type="button">
        <MarqueeText text="Muhammad Zayar bin Abdullah yang namanya sangat panjang" />
      </button>
    )
    const textEl = screen.getByTitle('Muhammad Zayar bin Abdullah yang namanya sangat panjang')
    stubOverflow(textEl, 300, 100)
    const button = screen.getByRole('button')

    fireEvent.focusIn(button)
    expect(textEl).toHaveClass('animate-marquee')

    fireEvent.focusOut(button)
    expect(textEl).not.toHaveClass('animate-marquee')
  })

  it('adds no tab stop or interactive element of its own', () => {
    render(
      <button type="button">
        <MarqueeText text="Zayar" />
      </button>
    )
    // Exactly one focusable element: the caller's own button.
    expect(screen.getAllByRole('button')).toHaveLength(1)
    const textEl = screen.getByTitle('Zayar')
    expect(textEl).not.toHaveAttribute('tabindex')
    expect(textEl.parentElement).not.toHaveAttribute('tabindex')
  })
})
