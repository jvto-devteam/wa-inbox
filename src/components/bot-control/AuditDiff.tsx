'use client'
import { Badge } from '@/components/ui/badge'

/**
 * Renders one audit row's before/after as a field-by-field comparison.
 *
 * Deliberately a table of changed fields rather than two blobs of JSON side by side. The
 * question an operator brings to this page is "what actually changed", and answering it with
 * two pretty-printed objects makes them diff by eye — which is where a one-character change
 * inside a forty-line config gets missed.
 *
 * The narrowing already happened at write time (`diffAuditFields` in src/lib/bot-control/audit.ts),
 * so every key present here is a key that genuinely differs. This component only has to show
 * them; it must not filter further, or it would hide changes that were recorded on purpose.
 */

/** Prisma hands these back as `JsonValue`; the page treats them as opaque records. */
export type AuditDiffSide = Record<string, unknown> | null

export function AuditDiff({ before, after }: { before: AuditDiffSide; after: AuditDiffSide }) {
  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])].sort()

  if (keys.length === 0) {
    // An action with no field-level change is normal — PUBLISH and ROLLBACK record what
    // happened, not a mutated object. Saying so beats an empty box that reads as a bug.
    return <p className="text-xs text-muted-foreground">Tidak ada perubahan field yang tercatat untuk aksi ini.</p>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="py-1 pr-3 font-medium">Field</th>
            <th className="py-1 pr-3 font-medium">Sebelum</th>
            <th className="py-1 font-medium">Sesudah</th>
          </tr>
        </thead>
        <tbody>
          {keys.map((key) => (
            <tr key={key} className="border-b last:border-0 align-top">
              <td className="py-1 pr-3 font-mono text-navy">{key}</td>
              <td className="py-1 pr-3">
                <AuditValue value={before?.[key]} tone="before" />
              </td>
              <td className="py-1">
                <AuditValue value={after?.[key]} tone="after" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * One side of one field.
 *
 * `null` and `undefined` are rendered as an explicit marker rather than as an empty cell,
 * because "this field did not exist before" and "this field was blank" are different facts and
 * an empty cell cannot tell them apart.
 */
function AuditValue({ value, tone }: { value: unknown; tone: 'before' | 'after' }) {
  if (value === null || value === undefined) {
    return <span className="text-muted-foreground">—</span>
  }

  if (typeof value === 'boolean') {
    return <Badge variant={value ? 'success' : 'muted'}>{value ? 'true' : 'false'}</Badge>
  }

  if (typeof value === 'object') {
    return (
      <pre className="max-w-xs overflow-x-auto whitespace-pre-wrap break-words rounded bg-muted/40 p-1 font-mono">
        {JSON.stringify(value, null, 2)}
      </pre>
    )
  }

  return (
    <span className={tone === 'before' ? 'text-muted-foreground line-through' : 'text-navy'}>{String(value)}</span>
  )
}
