import type { ZodType } from 'zod'

// Every route wrote `bodySchema.safeParse(await req.json())`, which reads as if it handles a
// bad body but does not: `req.json()` throws on anything that is not valid JSON *before*
// safeParse is ever reached. The rejection escapes the handler, so a truncated POST or a
// mis-set Content-Type produced an unhandled 500 with a stack trace instead of this app's
// mandated `{ error: string }` 4xx.
//
// parseJsonBody closes that gap by making the parse itself part of the validation result:
//
//   const parsed = await parseJsonBody(req, bodySchema)
//   if (!parsed.success) return NextResponse.json({ error: parsed.error }, { status: 400 })
//
// `invalidBodyMessage` is the copy used for BOTH failure modes on purpose. From the caller's
// side "this isn't JSON" and "this JSON is missing a field" are the same mistake, and each
// route already owns a specific Indonesian message for it — telling them apart would only
// leak parser detail.
export type ParsedBody<T> = { success: true; data: T } | { success: false; error: string }

export async function parseJsonBody<T>(
  req: Request,
  schema: ZodType<T>,
  invalidBodyMessage = 'Format permintaan tidak valid'
): Promise<ParsedBody<T>> {
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return { success: false, error: invalidBodyMessage }
  }

  const parsed = schema.safeParse(raw)
  if (!parsed.success) return { success: false, error: invalidBodyMessage }
  return { success: true, data: parsed.data }
}
