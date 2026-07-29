import { describe, it, expect } from 'vitest'
import { extractVariableNumbers, interpolateVariables } from './template-variables'

describe('extractVariableNumbers', () => {
  it('returns the distinct placeholder numbers in ascending order', () => {
    expect(extractVariableNumbers('Halo {{2}}, paket {{1}} sudah dikonfirmasi.')).toEqual([1, 2])
  })

  it('deduplicates a number that appears more than once', () => {
    expect(extractVariableNumbers('Halo {{1}}, apakah benar {{1}}?')).toEqual([1])
  })

  it('returns an empty array when there are no placeholders', () => {
    expect(extractVariableNumbers('Halo, ada yang bisa dibantu?')).toEqual([])
  })
})

describe('interpolateVariables', () => {
  it('substitutes each placeholder with its value by number', () => {
    expect(interpolateVariables('Halo {{1}}, paket {{2}}.', { 1: 'Bruno', 2: 'Ijen 3D2N' })).toBe('Halo Bruno, paket Ijen 3D2N.')
  })

  it('substitutes a missing value with an empty string rather than leaving the placeholder', () => {
    expect(interpolateVariables('Halo {{1}}.', {})).toBe('Halo .')
  })
})
