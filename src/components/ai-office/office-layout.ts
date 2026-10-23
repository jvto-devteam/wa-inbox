import type { AiAgentKey } from '@/lib/ai-office/activity'

/**
 * Denah Kantor AI = kantor JVTO sungguhan (foto owner 2026-10-23), dalam meter. Tanpa impor three, supaya bisa dites.
 *
 *   x -5 = dinding abu tua (kiri di foto): loker merah-putih di pojok, deretan meja hitam menghadap dinding di bawah
 *          jendela berkerai, hiasan kayu, bingkai foto + lemari dinding di atas sofa kulit hitam.
 *   z -4.5 = dinding hitam (kanan di foto): pintu ke ruang belakang dekat pojok, TV berlogo JVTO, meja eksekutif Admin.
 *   Sisi x +4 dan z +4.5 terbuka (tempat kamera berdiri, seperti fotografernya).
 *
 * Karakter menghadap -z pada yaw 0; `seatYaw` memutarnya ke arah mejanya.
 */
export type Vec2 = [number, number]

export const ROOM = { minX: -5, maxX: 4, minZ: -4.5, maxZ: 4.5, height: 3 } as const

/** Meja agen berderet di dinding abu; agen duduk menghadap dinding (-x). Kantor aslinya punya dua meja; dua ditambahkan sebaris. */
export const DESK_ROW_Z = { topik: -3.2, bot: -1.7, booking: -0.2, ringkasan: 1.3 } as const satisfies Record<AiAgentKey, number>
export const SEAT_X = -3.75
export const SEATS: Record<AiAgentKey, Vec2> = {
  topik: [SEAT_X, DESK_ROW_Z.topik],
  bot: [SEAT_X, DESK_ROW_Z.bot],
  booking: [SEAT_X, DESK_ROW_Z.booking],
  ringkasan: [SEAT_X, DESK_ROW_Z.ringkasan],
}
/** Yaw π/2: hadapan -z diputar ke -x (ke dinding abu). */
export const AGENT_SEAT_YAW = Math.PI / 2

/** Admin di belakang meja eksekutif, membelakangi dinding hitam, menghadap ruangan (+z). */
/** Digeser ke kanan TV (TV di x 0.8) supaya logo JVTO tidak tertutup Admin & mejanya (owner 2026-10-23). */
export const ADMIN_SEAT: Vec2 = [2.4, -4.0]
export const ADMIN_SEAT_YAW = Math.PI
/** Titik berdiri di depan meja eksekutif saat menyerahkan hasil (menghadap -z ke Admin). */
export const ADMIN_SPOT: Vec2 = [2.4, -2.2]
export const EXEC_DESK_Z = -3.2
export const TV_X = 0.8
/** Kursi bar kayu di depan sudut kiri meja eksekutif, di luar jalur jalan. */
export const BAR_STOOL: Vec2 = [0.95, -2.6]

/** Lorong di belakang kursi agen, lalu jalur melintang di depan meja eksekutif (kursi bar ada di luar jalur). */
export const AISLE_X = -2.9
export const LANE_Z = -1.6

export const WALK_SPEED = 2.4 // meter per detik
export const GIVE_S = 1.2

/** Mundur dari kursi ke lorong, menyusuri lorong, melintang ke depan meja eksekutif, maju ke Admin. */
export function deliveryPath(seat: Vec2): Vec2[] {
  return [seat, [AISLE_X, seat[1]], [AISLE_X, LANE_Z], [ADMIN_SPOT[0], LANE_Z], ADMIN_SPOT]
}

export function pathLength(p: Vec2[]): number {
  let d = 0
  for (let i = 1; i < p.length; i++) d += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1])
  return d
}

export function pointAt(p: Vec2[], dist: number): { pos: Vec2; dir: Vec2 } {
  let left = Math.max(0, dist)
  for (let i = 1; i < p.length; i++) {
    const seg = Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1])
    if (seg === 0) continue
    const dir: Vec2 = [(p[i][0] - p[i - 1][0]) / seg, (p[i][1] - p[i - 1][1]) / seg]
    if (left <= seg) return { pos: [p[i - 1][0] + dir[0] * left, p[i - 1][1] + dir[1] * left], dir }
    left -= seg
  }
  return { pos: p[p.length - 1], dir: [0, -1] }
}

/**
 * Ukuran tubuh & kursi. Pinggul ada di titik duduk dan paha mengarah ke depan, jadi dudukan kursi harus tepat di bawah
 * pinggul dan sandarannya di belakang punggung (badan berjari-jari 0,17). Kaki: paha 0,42 + betis sampai telapak 0,425
 * di bawah lutut -- tinggi pinggul duduk = panjang betis supaya telapak menapak lantai.
 */
export const HIP_OFFSET = 0.02
export const THIGH_RADIUS = 0.07
export const SHIN_TO_SOLE = 0.425
export const SEATED_BODY_Y = SHIN_TO_SOLE - HIP_OFFSET
export const SEAT_TOP = SEATED_BODY_Y + HIP_OFFSET - THIGH_RADIUS
export const STANDING_BODY_Y = 0.42 + SHIN_TO_SOLE - HIP_OFFSET
/** Pusat dudukan sedikit di belakang pinggul; sandaran (z +0.22 dari pusat) jatuh tepat di belakang punggung. */
export const CHAIR_Z = 0.05

/* ------------------------------------------------------------------ balon nama */

export type BubbleInput = { key: string; x: number; y: number; w: number; h: number }
export type BubblePlacement = { left: number; top: number; stem: number }

/**
 * Atur balon nama supaya tidak saling menimpa (owner 2026-10-23: teks agen tidak terbaca karena empat meja sebaris).
 * Balon yang kepalanya paling bawah di layar (paling dekat kamera) ditaruh dulu tepat di atas kepala; balon berikutnya
 * yang bertabrakan dinaikkan bertingkat. `stem` = panjang garis penunjuk dari bawah balon ke kepala.
 */
export function declutterBubbles(items: BubbleInput[], view: { width: number }, gap = 4, lift = 6): Record<string, BubblePlacement> {
  const placed: Array<{ left: number; top: number; w: number; h: number }> = []
  const out: Record<string, BubblePlacement> = {}
  for (const it of [...items].sort((a, b) => b.y - a.y)) {
    const left = Math.min(Math.max(gap, it.x - it.w / 2), Math.max(gap, view.width - it.w - gap))
    let top = it.y - it.h - lift
    for (let guard = 0; guard < 12; guard++) {
      const hit = placed.find((p) => left < p.left + p.w + gap && left + it.w + gap > p.left && top < p.top + p.h + gap && top + it.h + gap > p.top)
      if (!hit) break
      top = hit.top - it.h - gap
    }
    placed.push({ left, top, w: it.w, h: it.h })
    out[it.key] = { left, top, stem: Math.max(0, it.y - (top + it.h)) }
  }
  return out
}
