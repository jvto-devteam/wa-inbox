import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkdir, writeFile } from 'fs/promises'
import { POST } from './route'

vi.mock('fs/promises', () => {
  const mkdir = vi.fn()
  const writeFile = vi.fn()
  return { mkdir, writeFile, default: { mkdir, writeFile } }
})

// jsdom's FormData/File/Blob polyfills aren't recognized by Next's underlying undici Request
// implementation, so round-tripping a real `new Request(url, { body: someFormData })` through
// `.formData()` under this project's jsdom test environment hangs forever trying to parse a
// multipart body that was never correctly serialized. Stubbing `.formData()` to resolve
// directly (bypassing the wire-format step entirely, which the route handler never inspects
// anyway) sidesteps the incompatibility without touching the route code itself.
function fakeRequest(file: File | null): Request {
  return {
    formData: async () => {
      const form = new FormData()
      if (file) form.append('file', file)
      return form
    },
  } as unknown as Request
}

beforeEach(() => {
  vi.mocked(mkdir).mockReset().mockResolvedValue(undefined as never)
  vi.mocked(writeFile).mockReset().mockResolvedValue(undefined)
  process.env.APP_BASE_URL = 'https://wa-inbox.example.com'
})

describe('POST /api/uploads', () => {
  it('stores an image and returns its public URL, type, mimeType, and fileName', async () => {
    const file = new File(['fake-bytes'], 'foto.jpg', { type: 'image/jpeg' })

    const res = await POST(fakeRequest(file))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.type).toBe('image')
    expect(body.mimeType).toBe('image/jpeg')
    expect(body.fileName).toBe('foto.jpg')
    expect(body.url).toMatch(/^https:\/\/wa-inbox\.example\.com\/uploads\/.+\.jpg$/)
    expect(writeFile).toHaveBeenCalled()
  })

  it('classifies video and audio mime types correctly', async () => {
    const video = await (await POST(fakeRequest(new File(['x'], 'v.mp4', { type: 'video/mp4' })))).json()
    expect(video.type).toBe('video')

    const audio = await (await POST(fakeRequest(new File(['x'], 'a.ogg', { type: 'audio/ogg' })))).json()
    expect(audio.type).toBe('audio')
  })

  it('classifies anything else sendable (pdf, office docs) as document', async () => {
    const body = await (await POST(fakeRequest(new File(['x'], 'invoice.pdf', { type: 'application/pdf' })))).json()
    expect(body.type).toBe('document')
  })

  it('rejects a file with no recognizable mime type', async () => {
    const res = await POST(fakeRequest(new File(['x'], 'mystery', { type: '' })))
    expect(res.status).toBe(400)
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('rejects an image over the 5MB Meta cap', async () => {
    const oversized = new Uint8Array(6 * 1024 * 1024)
    const res = await POST(fakeRequest(new File([oversized], 'big.jpg', { type: 'image/jpeg' })))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/5MB/)
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('returns 400 when no file is present in the form', async () => {
    const res = await POST(fakeRequest(null))
    expect(res.status).toBe(400)
  })
})
