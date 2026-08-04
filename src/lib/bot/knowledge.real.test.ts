/**
 * Integration check against the REAL synced release in `catalog/` -- mirrors
 * catalog.real.test.ts's rationale: knowledge.test.ts pins resolveKnowledgeForTopic's
 * behaviour with fixtures, this file answers "does the data actually on disk still
 * resolve real facts for the topics that used to hand off?" (private_tour, rooming,
 * hotel, payment -- verified live against the real WABA sandbox on 2026-08-04).
 *
 * Skips itself when the release is not present (gitignored, synced by
 * `npm run sync:knowledge`), same as catalog.real.test.ts.
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { resolveKnowledgeForTopic } from './knowledge'

const RELEASE_PRESENT = fs.existsSync(path.join(process.cwd(), 'catalog', 'general-modules.json'))

describe.skipIf(!RELEASE_PRESENT)('resolveKnowledgeForTopic against the real synced catalog/', () => {
  // These four previously handed off under the old 4-topic-only composer (verified live in
  // the sandbox conversation) -- the whole point of this file is a regression guard.
  it.each(['private_tour', 'rooming', 'hotel', 'payment'] as const)(
    'resolves at least one real fact for "%s", which used to have none at all',
    (topic) => {
      const result = resolveKnowledgeForTopic(topic, 'is ijen safe?')
      expect(result.factualLines.length).toBeGreaterThan(0)
    }
  )

  it('resolves a real, live URL (not null) for the price topic', () => {
    const result = resolveKnowledgeForTopic('price', 'how much?')
    expect(result.primaryLink).toMatch(/^https:\/\/javavolcano-touroperator\.com\//)
  })

  it('returns no facts for a topic the real release genuinely has no modules for (route_endpoint)', () => {
    const result = resolveKnowledgeForTopic('route_endpoint', 'can we finish in bali?')
    expect(result.factualLines).toEqual([])
  })
})
