// Shared by the template creation form (src/app/(authenticated)/templates/page.tsx, which
// offers a data-source binding per position) and ComposeBox (which resolves/collects values at
// send time) -- both need to agree on what counts as a variable position in a template body.

// A {{n}} placeholder can appear more than once and in any order -- Meta's own convention
// (and the API's positional bodyParams array) is 1-indexed and sequential, so this collects
// every DISTINCT number used, sorted ascending, rather than assuming the template author wrote
// them in order or used each one only once.
export function extractVariableNumbers(body: string): number[] {
  const found = new Set<number>()
  for (const match of body.matchAll(/\{\{(\d+)\}\}/g)) found.add(Number(match[1]))
  return [...found].sort((a, b) => a - b)
}

export function interpolateVariables(body: string, valuesByNumber: Record<number, string>): string {
  return body.replace(/\{\{(\d+)\}\}/g, (_, n) => valuesByNumber[Number(n)] ?? '')
}
