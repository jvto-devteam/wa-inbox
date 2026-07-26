import { describe, it, expect, vi, beforeEach } from 'vitest'
import { sendCoexistText, sendCoexistMedia, getCoexistStatus, relinkCoexist } from './client'

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

describe('getCoexistStatus', () => {
  it('returns connected: true when wa-coexist status is "connected"', async () => {
    ;(fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'connected', user: { id: '1234@s.whatsapp.net' }, qr: null }),
    })
    const result = await getCoexistStatus(waNumber)
    expect(result).toEqual({ connected: true })
    expect(fetch).toHaveBeenCalledWith('http://localhost:4000/api/status')
  })

  it('returns connected: false when wa-coexist status is "disconnected"', async () => {
    ;(fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'disconnected', user: null, qr: null }),
    })
    const result = await getCoexistStatus(waNumber)
    expect(result).toEqual({ connected: false })
  })

  it('returns connected: false when wa-coexist status is "connecting"', async () => {
    ;(fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'connecting', user: null, qr: 'data:image/png...' }),
    })
    const result = await getCoexistStatus(waNumber)
    expect(result).toEqual({ connected: false })
  })

  it('returns connected: false when the request fails outright', async () => {
    ;(fetch as any).mockRejectedValue(new Error('network error'))
    const result = await getCoexistStatus(waNumber)
    expect(result).toEqual({ connected: false })
  })

  it('returns connected: false when HTTP response is not ok', async () => {
    ;(fetch as any).mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Internal server error' }),
    })
    const result = await getCoexistStatus(waNumber)
    expect(result).toEqual({ connected: false })
  })
})

describe('relinkCoexist', () => {
  it('posts to /api/relink', async () => {
    ;(fetch as any).mockResolvedValue({ ok: true, json: async () => ({ success: true }) })
    await relinkCoexist(waNumber)
    expect(fetch).toHaveBeenCalledWith('http://localhost:4000/api/relink', expect.objectContaining({ method: 'POST' }))
  })

  it('does not throw on success', async () => {
    ;(fetch as any).mockResolvedValue({ ok: true, json: async () => ({ success: true }) })
    await expect(relinkCoexist(waNumber)).resolves.toBeUndefined()
  })
})
