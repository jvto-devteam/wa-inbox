/**
 * Renders a system template: the text another program asks wa-inbox to send.
 *
 * Placeholders are NAMED (`{name}`), deliberately unlike the positional `{{1}}` of Meta templates
 * in src/lib/template-variables.ts. The values come from javavolcano-touroperator and
 * new-backoffice, whose code reads `'name' => $book->user->name`; a positional contract would
 * make every caller count, and silently shift every value the day an operator inserts one.
 *
 * Two rules replace the string-building the PHP originals did by hand:
 *
 * 1. A REQUIRED variable that is missing or blank makes rendering fail, listing every missing
 *    name. The API turns that into a 400, so the caller finds out now instead of a customer
 *    receiving "Hi , your booking  is confirmed".
 * 2. An OPTIONAL variable that is blank removes its entire line. That is what
 *    `$isDrop = $wa['drop'] != '' ? "\r\n*Drop:* ..." : ""` did — the label goes with the value.
 */
import type { SystemTemplateVariable, VariableValues } from './types'

const PLACEHOLDER = /\{([a-z][a-z0-9_]*)\}/g

export type RenderResult = { ok: true; text: string } | { ok: false; missing: string[] }

/** Every placeholder name in `body`, once each, in order of first appearance. */
export function placeholdersIn(body: string): string[] {
  return [...new Set([...body.matchAll(PLACEHOLDER)].map((match) => match[1]))]
}

function valueOf(values: VariableValues, name: string): string {
  const raw = values[name]
  if (raw === null || raw === undefined) return ''
  return String(raw).trim()
}

export function renderSystemTemplate(
  template: { body: string; variables: SystemTemplateVariable[] },
  values: VariableValues
): RenderResult {
  const declared = new Map(template.variables.map((variable) => [variable.name, variable]))

  const missing = template.variables
    .filter((variable) => variable.required && valueOf(values, variable.name) === '')
    .map((variable) => variable.name)
  if (missing.length > 0) return { ok: false, missing }

  const lines = template.body.replace(/\r\n/g, '\n').split('\n')
  const kept = lines.filter((line) =>
    [...line.matchAll(PLACEHOLDER)].every((match) => {
      const variable = declared.get(match[1])
      return !variable || variable.required || valueOf(values, variable.name) !== ''
    })
  )

  // One pass over the original text, so a value that happens to contain `{something}` is
  // inserted literally and never expanded a second time. An undeclared placeholder is left as
  // written: validateTemplateBody keeps those out of saved templates, and leaving it visible is
  // more honest than silently blanking it.
  const text = kept
    .join('\n')
    .replace(PLACEHOLDER, (whole, name: string) => (declared.has(name) ? valueOf(values, name) : whole))
    // A dropped line that sat between two paragraphs would otherwise leave a double gap.
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return { ok: true, text }
}

/** Problems that make a body unsafe to save. Empty means it is fine. */
export function validateTemplateBody(body: string, variables: SystemTemplateVariable[]): string[] {
  if (body.trim() === '') return ['Teks pesan tidak boleh kosong.']
  const declared = new Set(variables.map((variable) => variable.name))
  return placeholdersIn(body)
    .filter((name) => !declared.has(name))
    .map((name) => `Variabel {${name}} dipakai di teks tetapi tidak dideklarasikan.`)
}
