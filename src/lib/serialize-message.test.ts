import { describe, it, expect } from 'vitest'
import { serializeMessage, withMediaUrl } from './serialize-message'

function baseMessage(overrides: Partial<Parameters<typeof serializeMessage>[0]> = {}) {
  return {
    id: 'msg_1',
    direction: 'OUTBOUND',
    type: 'text',
    content: 'Halo',
    mediaUrl: null,
    mediaId: null,
    mimeType: null,
    fileName: null,
    channel: 'OFFICIAL',
    sentBy: 'AGENT',
    deliveryStatus: 'SENT',
    createdAt: new Date('2026-07-28T10:00:00.000Z'),
    botTrace: null,
    replyToId: null,
    templatePayload: null,
    ...overrides,
  } as Parameters<typeof serializeMessage>[0]
}

describe('serializeMessage mediaUrl resolution', () => {
  it('resolves to the /api/media proxy when mediaId is set (any Official-channel media)', () => {
    const view = serializeMessage(baseMessage({ mediaId: 'meta_media_1', mediaUrl: null }))
    expect(view.mediaUrl).toBe('/api/media/msg_1')
  })

  it('falls back to the raw mediaUrl when there is no mediaId (Unofficial-channel outbound media)', () => {
    const view = serializeMessage(baseMessage({ mediaId: null, mediaUrl: 'https://wa-inbox.example.com/uploads/x.jpg' }))
    expect(view.mediaUrl).toBe('https://wa-inbox.example.com/uploads/x.jpg')
  })

  it('is null when neither mediaId nor mediaUrl is set (a plain text message)', () => {
    const view = serializeMessage(baseMessage())
    expect(view.mediaUrl).toBeNull()
  })
})

describe('withMediaUrl mediaUrl resolution', () => {
  it('prefers the /api/media proxy over a raw mediaUrl when both happen to be set', () => {
    const result = withMediaUrl({ id: 'msg_2', mediaId: 'meta_media_2', mediaUrl: 'https://wa-inbox.example.com/uploads/y.jpg' })
    expect(result.mediaUrl).toBe('/api/media/msg_2')
  })

  it('falls back to the raw mediaUrl when there is no mediaId', () => {
    const result = withMediaUrl({ id: 'msg_3', mediaId: null, mediaUrl: 'https://wa-inbox.example.com/uploads/z.jpg' })
    expect(result.mediaUrl).toBe('https://wa-inbox.example.com/uploads/z.jpg')
  })

  it('is null when neither is set', () => {
    const result = withMediaUrl({ id: 'msg_4' })
    expect(result.mediaUrl).toBeNull()
  })
})
