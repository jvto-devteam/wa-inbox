import { describe, it, expect, vi, beforeEach } from 'vitest'
import { sendCoexistText, sendCoexistMedia } from './client'

const waNumber = { coexistBaseUrl: 'http://localhost:4000', coexistApiKey: 'key123', coexistNumberKey: 'num456' }

beforeEach(() => vi.stubGlobal('fetch', vi.fn()))

describe('sendCoexistText', () => {
  it('posts to /api/v1/send_message with api_key/number_key/phone_no/message and returns {} on success', async () => {
    ;(fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        status: '200',
        message: 'Message sent successfully',
        ack: 'successfully',
        phone_number: '6281234567890',
        message_sent: 'Halo!',
      }),
    })

    const result = await sendCoexistText(waNumber, '6281234567890', 'Halo!')

    // wa-coexist's /api/v1/send_message never returns a message ID, so
    // externalId is always undefined for this channel.
    expect(result).toEqual({})
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:4000/api/v1/send_message',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ api_key: 'key123', number_key: 'num456', phone_no: '6281234567890', message: 'Halo!' }),
      })
    )
  })

  it('throws using the message field when wa-coexist returns a non-"200" status', async () => {
    ;(fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ status: '1004', message: 'WhatsApp is not connected' }),
    })

    await expect(sendCoexistText(waNumber, '6281234567890', 'Halo!')).rejects.toThrow('WhatsApp is not connected')
  })

  it('throws when the HTTP response itself is not ok', async () => {
    ;(fetch as any).mockResolvedValue({
      ok: false,
      json: async () => ({ status: '1005', message: 'Internal error' }),
    })

    await expect(sendCoexistText(waNumber, '6281234567890', 'Halo!')).rejects.toThrow('Internal error')
  })
})

describe('sendCoexistMedia', () => {
  it('posts to /api/v1/send_image_url with the caption in the `message` field for type image', async () => {
    ;(fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ status: '200', message: 'Successfully', ack: 'successfully' }),
    })

    const result = await sendCoexistMedia(waNumber, '6281234567890', 'https://x/img.jpg', 'image', 'Caption')

    expect(result).toEqual({})
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:4000/api/v1/send_image_url',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          api_key: 'key123',
          number_key: 'num456',
          phone_no: '6281234567890',
          url: 'https://x/img.jpg',
          message: 'Caption',
        }),
      })
    )
  })

  it('posts to /api/v1/send_file_url for type document, dropping caption (wa-coexist has no caption field there)', async () => {
    ;(fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ status: '200', message: 'Successfully', ack: 'successfully' }),
    })

    const result = await sendCoexistMedia(waNumber, '6281234567890', 'https://x/doc.pdf', 'document', 'ignored caption')

    expect(result).toEqual({})
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:4000/api/v1/send_file_url',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          api_key: 'key123',
          number_key: 'num456',
          phone_no: '6281234567890',
          url: 'https://x/doc.pdf',
        }),
      })
    )
  })

  it('posts to /api/v1/send_file_url for type video', async () => {
    ;(fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ status: '200', message: 'Successfully', ack: 'successfully' }),
    })

    await sendCoexistMedia(waNumber, '6281234567890', 'https://x/vid.mp4', 'video')

    expect(fetch).toHaveBeenCalledWith('http://localhost:4000/api/v1/send_file_url', expect.anything())
  })

  it('throws when wa-coexist returns a non-"200" status for media sends', async () => {
    ;(fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ status: '1006', message: 'Missing required fields: phone_no, url' }),
    })

    await expect(sendCoexistMedia(waNumber, '6281234567890', 'https://x/img.jpg', 'image')).rejects.toThrow(
      'Missing required fields: phone_no, url'
    )
  })
})

// Every wa-coexist call must be bounded. sendCoexistText in particular runs on
// the bot-reply path (src/lib/send.ts, reached from the Meta inbound webhook),
// and wa-coexist's own ensureConnected can block ~15s when the session is
// down — an unbounded fetch there stalls the webhook past Meta's delivery
// window.
// The `(fetch as any)` shorthand used above predates this block; new
// assertions use vi.mocked() so they stay type-checked.
function mockedFetch() {
  return vi.mocked(fetch)
}

describe('wa-coexist request timeouts', () => {
  function signalOf(call: number) {
    return (mockedFetch().mock.calls[call][1] ?? {}).signal
  }

  it('sends an AbortSignal with every send request', async () => {
    mockedFetch().mockResolvedValue({ ok: true, json: async () => ({ status: '200' }) } as unknown as Response)

    await sendCoexistText(waNumber, '6281234567890', 'Halo!')
    await sendCoexistMedia(waNumber, '6281234567890', 'https://x/img.jpg', 'image')

    expect(signalOf(0)).toBeInstanceOf(AbortSignal)
    expect(signalOf(1)).toBeInstanceOf(AbortSignal)
  })

  it('propagates an aborted send as an error rather than swallowing it', async () => {
    // AbortSignal.timeout firing rejects the fetch with a TimeoutError
    // DOMException; sendCoexistText has no catch, so it must surface to the
    // caller (src/lib/send.ts) exactly like any other send failure.
    mockedFetch().mockRejectedValue(new DOMException('The operation was aborted due to timeout', 'TimeoutError'))

    await expect(sendCoexistText(waNumber, '6281234567890', 'Halo!')).rejects.toThrow(/timeout/i)
  })

  it('propagates an aborted media send as an error', async () => {
    mockedFetch().mockRejectedValue(new DOMException('The operation was aborted due to timeout', 'TimeoutError'))

    await expect(sendCoexistMedia(waNumber, '6281234567890', 'https://x/img.jpg', 'image')).rejects.toThrow(/timeout/i)
  })
})
