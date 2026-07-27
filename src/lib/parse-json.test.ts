import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { parseJsonBody } from './parse-json'

const schema = z.object({ name: z.string().min(1), count: z.number() })

function post(body: BodyInit) {
  return new Request('http://localhost/api/thing', { method: 'POST', body })
}

describe('parseJsonBody', () => {
  it('returns the schema-parsed data for a valid body', async () => {
    const parsed = await parseJsonBody(post(JSON.stringify({ name: 'Ijen', count: 2 })), schema)

    expect(parsed).toEqual({ success: true, data: { name: 'Ijen', count: 2 } })
  })

  it('strips nothing and preserves the schema output type', async () => {
    const parsed = await parseJsonBody(post(JSON.stringify({ name: 'Ijen', count: 2 })), schema)

    // Narrowing on `success` is what lets every route keep using `parsed.data` unchanged.
    if (!parsed.success) throw new Error('expected success')
    expect(parsed.data.name).toBe('Ijen')
  })

  it('fails cleanly when the body is valid JSON but the wrong shape', async () => {
    const parsed = await parseJsonBody(post(JSON.stringify({ name: '' })), schema, 'Data tidak valid')

    expect(parsed).toEqual({ success: false, error: 'Data tidak valid' })
  })

  // The bug this exists for: `schema.safeParse(await req.json())` never reaches safeParse
  // here — req.json() rejects, the rejection escapes the route handler, and the caller gets
  // an unhandled 500 with a stack trace.
  it('fails cleanly instead of throwing when the body is not JSON at all', async () => {
    const parsed = await parseJsonBody(post('<html>nope</html>'), schema, 'Data tidak valid')

    expect(parsed).toEqual({ success: false, error: 'Data tidak valid' })
  })

  it('fails cleanly on truncated JSON', async () => {
    const parsed = await parseJsonBody(post('{"name": "Ijen",'), schema, 'Data tidak valid')

    expect(parsed).toEqual({ success: false, error: 'Data tidak valid' })
  })

  it('fails cleanly on an empty body', async () => {
    const parsed = await parseJsonBody(post(''), schema, 'Data tidak valid')

    expect(parsed).toEqual({ success: false, error: 'Data tidak valid' })
  })

  it('uses generic Indonesian copy when the route supplies no message', async () => {
    const parsed = await parseJsonBody(post('not json'), schema)

    expect(parsed).toEqual({ success: false, error: 'Format permintaan tidak valid' })
  })

  it('rejects a JSON scalar body that is not the expected object', async () => {
    const parsed = await parseJsonBody(post('"just a string"'), schema, 'Data tidak valid')

    expect(parsed).toEqual({ success: false, error: 'Data tidak valid' })
  })
})
