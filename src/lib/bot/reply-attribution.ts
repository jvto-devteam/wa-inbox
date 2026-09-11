import { extractRupiahAmounts, extractUrls } from './reply-verifier'
import type { AttributedLine, DecisionKnowledge, ReplyAttribution } from './types'

/**
 * Paragraf balasan FINAL -> baris knowledge/katalog yang cocok. Murni dan deterministik, tanpa
 * model; hasilnya pencocokan sistem, bukan kutipan model, jadi UI menulisnya "cocok dengan".
 * BotTracePopover (klien) mengimpor `splitParagraphs` dari sini, jadi berkas ini hanya boleh
 * mengimpor modul murni -- reply-verifier.ts tidak punya impor sama sekali.
 *
 * Cocok bila SALAH SATU: nominal Rupiah sama; URL sama; atau kata isi yang sama
 * >= MIN_SHARED_CONTENT_WORDS dan >= MIN_SHARED_RATIO dari kata isi baris.
 */
export const MIN_CONTENT_WORD_LENGTH = 4
export const MIN_SHARED_CONTENT_WORDS = 3
export const MIN_SHARED_RATIO = 0.3

const AMOUNT_EPSILON = 0.5
const BULLET = /^(?:[-*•]|\d+[.)])\s+/

/** Salinan persis STOPWORDS di runtime-integration.ts, yang tidak bisa diimpor ke sini (menarik prisma). */
const STOPWORDS = new Set([
  'yang', 'untuk', 'dari', 'dengan', 'atau', 'dan', 'ada', 'apa', 'apakah', 'adakah', 'bisa',
  'bisakah', 'boleh', 'saya', 'kami', 'kita', 'anda', 'ini', 'itu', 'berapa', 'kapan', 'dimana',
  'mana', 'bagaimana', 'gimana', 'kenapa', 'mengapa', 'siapa', 'mohon', 'tolong', 'terima',
  'kasih', 'selamat', 'halo', 'hallo', 'sudah', 'belum', 'akan', 'juga', 'saja', 'kalau', 'jika',
  'tapi', 'tetapi', 'karena', 'tersebut', 'tentang', 'seperti', 'punya', 'ingin', 'pengen',
  'the', 'and', 'for', 'with', 'you', 'are', 'what', 'can', 'how', 'where', 'when', 'does',
  'have', 'this', 'that', 'there', 'would', 'could', 'should', 'please', 'thanks', 'hello',
  'about', 'from', 'your', 'much', 'many',
])

export function splitParagraphs(text: string): string[] {
  const paragraphs: string[] = []
  for (const block of text.split(/\n\s*\n/)) {
    let current: string[] = []
    for (const raw of block.split('\n')) {
      const line = raw.trim()
      if (!line) continue
      if (BULLET.test(line) && current.length > 0) {
        paragraphs.push(current.join('\n'))
        current = []
      }
      current.push(line)
    }
    if (current.length > 0) paragraphs.push(current.join('\n'))
  }
  return paragraphs
}

function contentWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length >= MIN_CONTENT_WORD_LENGTH && !STOPWORDS.has(word))
  )
}

function normalizeUrl(url: string): string {
  return url.toLowerCase().replace(/\/+$/, '')
}

/** "Judul (vN)" -> "Judul". Akhiran itu dibentuk collect()/allManagedFacts() di runtime-integration.ts. */
function titleFromSource(source: string, version: number | undefined): string {
  if (version === undefined) return source
  const suffix = ` (v${version})`
  return source.endsWith(suffix) ? source.slice(0, -suffix.length) : source
}

type Candidate = { attributed: AttributedLine; words: Set<string>; amounts: number[]; urls: Set<string> }

function candidate(attributed: AttributedLine): Candidate {
  return {
    attributed,
    words: contentWords(attributed.line),
    amounts: extractRupiahAmounts(attributed.line),
    urls: new Set(extractUrls(attributed.line).map(normalizeUrl)),
  }
}

function matches(c: Candidate, words: Set<string>, amounts: number[], urls: Set<string>): boolean {
  if (amounts.some((a) => c.amounts.some((b) => Math.abs(a - b) < AMOUNT_EPSILON))) return true
  for (const url of urls) if (c.urls.has(url)) return true
  if (c.words.size === 0) return false
  let shared = 0
  for (const word of c.words) if (words.has(word)) shared += 1
  return shared >= MIN_SHARED_CONTENT_WORDS && shared / c.words.size >= MIN_SHARED_RATIO
}

export function attributeReply(replyText: string, knowledge: DecisionKnowledge): ReplyAttribution[] {
  const candidates = [
    ...knowledge.catalogLines.map((line) => candidate({ kind: 'catalog', line })),
    ...knowledge.managedLines.map((m) =>
      candidate({
        kind: 'managed',
        line: m.line,
        ...(m.sourceId !== undefined ? { sourceId: m.sourceId } : {}),
        title: titleFromSource(m.source, m.version),
        ...(m.version !== undefined ? { version: m.version } : {}),
      })
    ),
  ]

  const attributions: ReplyAttribution[] = []
  splitParagraphs(replyText).forEach((paragraph, index) => {
    const words = contentWords(paragraph)
    const amounts = extractRupiahAmounts(paragraph)
    const urls = new Set(extractUrls(paragraph).map(normalizeUrl))
    const lines = candidates.filter((c) => matches(c, words, amounts, urls)).map((c) => c.attributed)
    if (lines.length > 0) attributions.push({ paragraph: index, lines })
  })
  return attributions
}
