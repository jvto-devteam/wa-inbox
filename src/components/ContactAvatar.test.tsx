import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ContactAvatar } from './ContactAvatar'

describe('ContactAvatar', () => {
  it('renders the photo when avatarUrl is set', () => {
    render(<ContactAvatar name="Bruno Figarola" avatarUrl="https://x.test/photo.jpg" />)
    const img = screen.getByAltText('Bruno Figarola') as HTMLImageElement
    expect(img.src).toBe('https://x.test/photo.jpg')
  })

  it('falls back to the first letter of the name, uppercased, when there is no photo', () => {
    render(<ContactAvatar name="bruno figarola" avatarUrl={null} />)
    expect(screen.getByText('B')).toBeInTheDocument()
  })

  it('falls back to "?" when there is no name and no photo', () => {
    render(<ContactAvatar name={null} avatarUrl={null} />)
    expect(screen.getByText('?')).toBeInTheDocument()
  })
})
