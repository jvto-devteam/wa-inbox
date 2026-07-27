import { describe, it, expect } from 'vitest'
import { isHandoffLogMessage, displayMessageContent, HANDOFF_LOG_TEXT } from './message-display'

describe('isHandoffLogMessage', () => {
  it('is true only for a bot-authored row with no content', () => {
    expect(isHandoffLogMessage({ sentBy: 'BOT', content: null })).toBe(true)
  })

  it('is false for a bot message that actually has content', () => {
    expect(isHandoffLogMessage({ sentBy: 'BOT', content: 'Halo!' })).toBe(false)
  })

  it('is false for a content-less message from a human agent or the customer', () => {
    expect(isHandoffLogMessage({ sentBy: 'AGENT', content: null })).toBe(false)
    expect(isHandoffLogMessage({ sentBy: 'CUSTOMER', content: null })).toBe(false)
  })

  it('is false when the sender is unknown (null), as on a conversation with no messages yet', () => {
    expect(isHandoffLogMessage({ sentBy: null, content: null })).toBe(false)
  })

  it('treats an empty string as real content, not a handoff log', () => {
    expect(isHandoffLogMessage({ sentBy: 'BOT', content: '' })).toBe(false)
  })
})

describe('displayMessageContent', () => {
  it('returns the handoff placeholder for a logged handoff decision', () => {
    expect(displayMessageContent({ sentBy: 'BOT', content: null, type: 'text' })).toBe(HANDOFF_LOG_TEXT)
  })

  it('returns the message content verbatim when there is any', () => {
    expect(displayMessageContent({ sentBy: 'AGENT', content: 'Terima kasih', type: 'text' })).toBe('Terima kasih')
  })

  it('falls back to the [type] marker for a content-less non-bot message', () => {
    expect(displayMessageContent({ sentBy: 'CUSTOMER', content: null, type: 'image' })).toBe('[image]')
  })

  it('returns an empty string when there is neither content nor a type', () => {
    expect(displayMessageContent({ sentBy: 'CUSTOMER', content: null })).toBe('')
  })
})
