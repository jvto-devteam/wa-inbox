import { describe, expect, it } from 'vitest'
import {
  ADMIN_SEAT,
  BAR_STOOL,
  TV_X,
  declutterBubbles,
  ADMIN_SPOT,
  CHAIR_Z,
  EXEC_DESK_Z,
  HIP_OFFSET,
  ROOM,
  SEATS,
  SEAT_TOP,
  SEATED_BODY_Y,
  SHIN_TO_SOLE,
  STANDING_BODY_Y,
  THIGH_RADIUS,
  deliveryPath,
  pathLength,
  pointAt,
  type Vec2,
} from './office-layout'

/** Kotak lantai perabot yang tidak boleh ditembus rute jalan: [minX, maxX, minZ, maxZ]. */
const OBSTACLES: Record<string, [number, number, number, number]> = {
  // Meja agen (lebar 1,35 di sepanjang z, dalam 0,8 dari dinding) -- pusat x = kursi - 0,75.
  ...Object.fromEntries(Object.entries(SEATS).map(([k, [x, z]]) => [`meja ${k}`, [x - 0.75 - 0.4, x - 0.75 + 0.4, z - 0.675, z + 0.675]])),
  'meja eksekutif': [ADMIN_SEAT[0] - 1.1, ADMIN_SEAT[0] + 1.1, EXEC_DESK_Z - 0.45, EXEC_DESK_Z + 0.45],
  'kursi bar': [BAR_STOOL[0] - 0.17, BAR_STOOL[0] + 0.17, BAR_STOOL[1] - 0.17, BAR_STOOL[1] + 0.17],
  'meja marmer': [-3.93, -2.97, 2.82, 3.78],
  'kipas': [3.0, 3.4, -1.1, -0.7],
}

function hits(p: Vec2, box: [number, number, number, number], margin = 0.2) {
  return p[0] > box[0] - margin && p[0] < box[1] + margin && p[1] > box[2] - margin && p[1] < box[3] + margin
}

describe('denah kantor JVTO', () => {
  it('semua kursi dan titik serah ada di dalam ruangan', () => {
    for (const p of [...Object.values(SEATS), ADMIN_SEAT, ADMIN_SPOT]) {
      expect(p[0]).toBeGreaterThan(ROOM.minX)
      expect(p[0]).toBeLessThan(ROOM.maxX)
      expect(p[1]).toBeGreaterThan(ROOM.minZ)
      expect(p[1]).toBeLessThan(ROOM.maxZ)
    }
  })

  it('meja agen tidak saling tumpuk dan menempel di dinding abu', () => {
    const zs = Object.values(SEATS).map(([, z]) => z).sort((a, b) => a - b)
    for (let i = 1; i < zs.length; i++) expect(zs[i] - zs[i - 1]).toBeGreaterThanOrEqual(1.35)
    for (const [x] of Object.values(SEATS)) expect(x - 0.75 - 0.4).toBeGreaterThanOrEqual(ROOM.minX)
  })

  it('Admin dan monitornya tidak menutupi TV berlogo JVTO (TV lebar 1,62)', () => {
    expect(Math.abs(ADMIN_SEAT[0] - TV_X)).toBeGreaterThan(0.81 + 0.5)
  })

  it('titik serah ada di depan meja eksekutif, menghadap Admin', () => {
    expect(ADMIN_SPOT[0]).toBe(ADMIN_SEAT[0])
    expect(ADMIN_SPOT[1]).toBeGreaterThan(EXEC_DESK_Z + 0.45)
    expect(ADMIN_SPOT[1] - (EXEC_DESK_Z + 0.45)).toBeLessThan(0.8)
  })

  it('rute mengantar dari setiap kursi tidak menembus perabot (selain meja sendiri di titik awal)', () => {
    for (const [key, seat] of Object.entries(SEATS)) {
      const path = deliveryPath(seat)
      const len = pathLength(path)
      for (let d = 0.6; d < len - 0.05; d += 0.1) {
        const { pos } = pointAt(path, d)
        for (const [name, box] of Object.entries(OBSTACLES)) {
          if (name === `meja ${key}`) continue
          expect(hits(pos, box, name === 'meja eksekutif' ? 0 : 0.2), `${key} menabrak ${name} di ${pos}`).toBe(false)
        }
      }
      expect(path.at(-1)).toEqual(ADMIN_SPOT)
    }
  })

  it('pointAt menyusuri segmen dan berhenti di ujung', () => {
    const p: Vec2[] = [[0, 0], [0, 2], [3, 2]]
    expect(pathLength(p)).toBe(5)
    expect(pointAt(p, 3)).toEqual({ pos: [1, 2], dir: [1, 0] })
    expect(pointAt(p, 99).pos).toEqual([3, 2])
  })
})

describe('posisi duduk', () => {
  it('paha bertumpu di dudukan, telapak menapak lantai, dudukan di bawah pinggul', () => {
    const hip = SEATED_BODY_Y + HIP_OFFSET
    expect(hip - THIGH_RADIUS).toBeCloseTo(SEAT_TOP, 6)
    expect(hip - SHIN_TO_SOLE).toBeCloseTo(0, 6)
    expect(Math.abs(CHAIR_Z)).toBeLessThan(0.23)
    expect(CHAIR_Z + 0.24 - 0.025).toBeGreaterThan(0.17)
  })

  it('berdiri: telapak menapak lantai', () => {
    expect(STANDING_BODY_Y + HIP_OFFSET - 0.42 - SHIN_TO_SOLE).toBeCloseTo(0, 6)
  })
})

describe('declutterBubbles', () => {
  const box = (p: { left: number; top: number }, w: number, h: number) => ({ l: p.left, r: p.left + w, t: p.top, b: p.top + h })
  it('balon yang kepalanya berdekatan tidak saling menimpa; yang dinaikkan diberi garis penunjuk', () => {
    const items = [
      { key: 'a', x: 300, y: 200, w: 120, h: 30 },
      { key: 'b', x: 340, y: 196, w: 120, h: 30 },
      { key: 'c', x: 380, y: 192, w: 120, h: 30 },
      { key: 'd', x: 700, y: 210, w: 120, h: 30 },
    ]
    const out = declutterBubbles(items, { width: 1000 })
    const rects = items.map((i) => box(out[i.key], i.w, i.h))
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++) {
        const [p, q] = [rects[i], rects[j]]
        expect(p.r <= q.l || q.r <= p.l || p.b <= q.t || q.b <= p.t).toBe(true)
      }
    // Paling bawah (a) tepat di atas kepala; yang lain naik dan bergaris penunjuk.
    expect(out.a.stem).toBeLessThan(10)
    expect(out.c.stem).toBeGreaterThan(30)
    // Yang jauh (d) tidak terganggu.
    expect(out.d.stem).toBeLessThan(10)
  })

  it('tidak keluar dari tepi kiri/kanan', () => {
    const out = declutterBubbles([{ key: 'x', x: 5, y: 100, w: 120, h: 30 }, { key: 'y', x: 995, y: 100, w: 120, h: 30 }], { width: 1000 })
    expect(out.x.left).toBeGreaterThanOrEqual(0)
    expect(out.y.left + 120).toBeLessThanOrEqual(1000)
  })
})
