import type { ReactNode } from 'react'

type Node = string | ReactNode

// WhatsApp's own formatting marks: a marker only takes effect when it isn't touching
// whitespace on the inside (`* text *` stays literal, `*text*` bolds) -- these patterns
// encode that same rule so pasted WhatsApp text renders identically here.
const MONO_RE = /```([^`]+)```/g
const BOLD_RE = /\*([^\s*](?:[^*]*[^\s*])?)\*/g
const ITALIC_RE = /_([^\s_](?:[^_]*[^\s_])?)_/g
const STRIKE_RE = /~([^\s~](?:[^~]*[^~])?)~/g
// Greedy up to the last non-space character, then backtracks off common trailing
// punctuation (a sentence-ending '.', a wrapping ')', etc.) that's almost never actually
// part of the URL -- "cek link https://example.com/x!" must not swallow the '!'.
const URL_RE = /(https?:\/\/[^\s]+[^\s.,!?;:'")\]}])/g

let keySeq = 0

/**
 * Splits every plain-string entry in `nodes` on `regex`, wrapping each capture group in
 * `wrap`. Already-wrapped (non-string) entries pass through untouched -- this is what lets
 * four independent passes (mono, bold, italic, strikethrough) run in sequence without a
 * later pass re-parsing text a mark already consumed.
 */
function splitByPattern(nodes: Node[], regex: RegExp, wrap: (content: string, key: string) => ReactNode): Node[] {
  const result: Node[] = []
  for (const node of nodes) {
    if (typeof node !== 'string') {
      result.push(node)
      continue
    }
    let lastIndex = 0
    let match: RegExpExecArray | null
    regex.lastIndex = 0
    while ((match = regex.exec(node))) {
      if (match.index > lastIndex) result.push(node.slice(lastIndex, match.index))
      result.push(wrap(match[1], `wa-fmt-${keySeq++}`))
      lastIndex = match.index + match[0].length
    }
    if (lastIndex < node.length) result.push(node.slice(lastIndex))
  }
  return result
}

/**
 * Renders WhatsApp's *bold*, _italic_, ~strikethrough~, and ```monospace``` marks, plus
 * auto-links bare http(s) URLs. Linkification runs FIRST, before the mark passes: a link
 * becomes a non-string node immediately, and every later pass only ever touches remaining
 * plain-string entries -- so a URL that happens to contain `_` or `~` can never be partially
 * swallowed by the italic/strikethrough passes running after it.
 */
export function formatWhatsAppText(text: string): ReactNode[] {
  let nodes: Node[] = [text]
  nodes = splitByPattern(nodes, URL_RE, (url, k) => (
    <a key={k} href={url} target="_blank" rel="noreferrer" className="text-brand underline">
      {url}
    </a>
  ))
  nodes = splitByPattern(nodes, MONO_RE, (c, k) => (
    <code key={k} className="rounded bg-black/10 px-1 font-mono text-[0.9em]">
      {c}
    </code>
  ))
  nodes = splitByPattern(nodes, BOLD_RE, (c, k) => <strong key={k}>{c}</strong>)
  nodes = splitByPattern(nodes, ITALIC_RE, (c, k) => <em key={k}>{c}</em>)
  nodes = splitByPattern(nodes, STRIKE_RE, (c, k) => (
    <span key={k} className="line-through">
      {c}
    </span>
  ))
  return nodes as ReactNode[]
}
