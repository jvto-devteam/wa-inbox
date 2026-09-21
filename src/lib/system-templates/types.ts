/**
 * One variable a system template expects its calling program to fill.
 *
 * Stored as JSON on `SystemTemplate.variables` (prisma/schema.prisma). `required` decides what a
 * missing value means: a required one makes the API refuse the send (400) rather than deliver a
 * message with a hole in it; an optional one makes its whole line disappear (render.ts).
 */
export type SystemTemplateVariable = {
  name: string
  required: boolean
  /** Shown in the editor's preview, and used by the seed parity test. */
  example?: string
  description?: string
}

export type VariableValues = Record<string, string | number | null | undefined>

/** Narrows the untyped JSON column to the shape above, dropping anything malformed. */
export function parseVariables(value: unknown): SystemTemplateVariable[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item: unknown) => {
    if (typeof item !== 'object' || item === null) return []
    const record = item as Record<string, unknown>
    if (typeof record.name !== 'string') return []
    return [
      {
        name: record.name,
        required: record.required === true,
        ...(typeof record.example === 'string' ? { example: record.example } : {}),
        ...(typeof record.description === 'string' ? { description: record.description } : {}),
      },
    ]
  })
}
