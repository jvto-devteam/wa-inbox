import { describe, it, expect } from 'vitest'
import { planSeed } from './seed-system-templates'
import type { SystemTemplateSeed } from '@/lib/system-templates/seed-data'

const seed = (key: string): SystemTemplateSeed => ({
  key,
  name: key,
  description: '',
  audience: 'INTERNAL',
  body: 'x',
  imageUrl: null,
  variables: [],
  source: '',
})

describe('planSeed', () => {
  it('creates only the keys that do not exist, leaving operator-edited rows alone', () => {
    const plan = planSeed([seed('a'), seed('b'), seed('c')], new Set(['b']))
    expect(plan.create.map((s) => s.key)).toEqual(['a', 'c'])
    expect(plan.existing).toEqual(['b'])
  })
})
