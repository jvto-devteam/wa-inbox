import { describe, it, expect } from 'vitest'
import { RESOLVER_TOPICS } from '@/lib/bot/module-resolver'
import { JOB_LABEL_NAMES, TOPIC_LABEL_NAMES, jobLabelName, topicLabelName } from './label-names'

describe('label-names', () => {
  it('punya nama untuk setiap topik resolver, tanpa nama ganda', () => {
    expect(Object.keys(TOPIC_LABEL_NAMES).sort()).toEqual([...RESOLVER_TOPICS].sort())
    expect(new Set(Object.values(TOPIC_LABEL_NAMES)).size).toBe(RESOLVER_TOPICS.length)
  })

  it('punya nama untuk J1–J5, dan J2 bernama "Harga & nilai"', () => {
    expect(Object.keys(JOB_LABEL_NAMES)).toEqual(['J1', 'J2', 'J3', 'J4', 'J5'])
    expect(jobLabelName('J2')).toBe('Harga & nilai')
    expect(topicLabelName('price')).toBe('Harga')
  })

  it('id yang tidak dikenal tampil apa adanya, termasuk nama properti bawaan objek', () => {
    expect(topicLabelName('bukan_topik')).toBe('bukan_topik')
    expect(topicLabelName('constructor')).toBe('constructor')
    expect(jobLabelName('J9')).toBe('J9')
  })
})
