import { describe, expect, it } from 'vitest'
import { deliveryPath, pathLength, pointAt } from './Office3D'

describe('rute mengantar hasil ke admin', () => {
  it('mundur dari kursi, lewat lorong, masuk pintu ruang kaca, berhenti di depan meja admin', () => {
    const p = deliveryPath([-4, -1.2])
    expect(p[0]).toEqual([-4, -1.2])
    expect(p[1]).toEqual([-4, -0.5])
    expect(p.at(-1)).toEqual([5.4, -0.95])
    // Pintu kaca ada di x 4.7-6.1 pada z 0.2: segmen terakhir melintas di sana.
    const [a, b] = p.slice(-2)
    expect(a[0]).toBeGreaterThan(4.7)
    expect(a[0]).toBeLessThan(6.1)
    expect(a[1]).toBeGreaterThan(0.2)
    expect(b[1]).toBeLessThan(0.2)
  })

  it('pointAt menyusuri segmen dan berhenti di ujung', () => {
    const p: Array<[number, number]> = [[0, 0], [0, 2], [3, 2]]
    expect(pathLength(p)).toBe(5)
    expect(pointAt(p, 1).pos).toEqual([0, 1])
    expect(pointAt(p, 3).pos).toEqual([1, 2])
    expect(pointAt(p, 3).dir).toEqual([1, 0])
    expect(pointAt(p, 99).pos).toEqual([3, 2])
  })
})
