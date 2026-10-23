'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { ContactShadows, Html, OrbitControls, RoundedBox } from '@react-three/drei'
import * as THREE from 'three'
import type { AiAgentKey } from '@/lib/ai-office/activity'
import type { AgentMode } from '@/lib/ai-office/state'

/**
 * Kantor AI versi 3D (WebGL, React Three Fiber; owner 2026-10-23 "buat lebih real 3D"). Dimuat hanya di browser
 * (`next/dynamic` ssr:false dari AiOffice). Semua geometri dibuat di sini -- tidak ada aset luar. Karakter bersendi
 * (kepala, lengan atas/bawah, paha, betis) dianimasikan per frame:
 * - SIAGA: tetap hidup -- mengetik santai, sesekali menoleh, minum kopi, atau meregangkan badan; layar bergulir pelan.
 * - BEKERJA: mengetik cepat, monitor terang + progress bar, cincin bercahaya di lantai, indikator berputar di atas kepala.
 * - SELESAI: tangan terangkat sebentar; balasan bot yang terkirim melepas amplop terbang.
 * - MENGANTAR: berdiri, berjalan membawa kertas ke ruang kaca, menyerahkannya ke Admin, kembali duduk.
 * - GAGAL: menggeleng, indikator merah.
 * Statusnya datang dari event nyata (lihat AiOffice); adegan ini hanya menggambarkannya.
 */

export type Office3DAgent = {
  key: AiAgentKey
  name: string
  shirt: string
  hair: string
  skin: string
  mode: AgentMode
  label: string
}

type Vec2 = [number, number]
type Look = { shirt: string; hair: string; skin: string }

const SEATS: Record<AiAgentKey, Vec2> = { topik: [-4, -1.2], bot: [-1.2, -1.2], booking: [-4, 2.0], ringkasan: [-1.2, 2.0] }
/** Admin duduk menghadap pintu ruang kaca (+z); tamu meja berdiri di seberang mejanya. */
const ADMIN_SEAT: Vec2 = [5.4, -2.4]
const ADMIN_SPOT: Vec2 = [5.4, -0.95]
const CORRIDOR_X = 0.8
const DOOR_Z = 1.0
const WALK_SPEED = 3 // meter per detik
const GIVE_S = 1.2
const STEP_RATE = 10

const MODE_COLOR: Record<AgentMode, string> = { idle: '#94a3b8', working: '#3b82f6', done: '#22c55e', handoff: '#f59e0b', error: '#ef4444' }

/* ------------------------------------------------------------------ perabot */

function Monitor({ accent, mode }: { accent: string; mode: AgentMode | 'admin' }) {
  const bars = useRef<THREE.Group>(null)
  const progress = useRef<THREE.Mesh>(null)
  const screen = useRef<THREE.MeshStandardMaterial>(null)
  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    const active = mode === 'working'
    if (screen.current) {
      screen.current.emissive.set(mode === 'error' ? '#b91c1c' : mode === 'done' ? '#15803d' : active ? accent : '#1e3a5f')
      screen.current.emissiveIntensity = active ? 1.3 + Math.sin(t * 6) * 0.2 : mode === 'error' ? 1.1 + Math.sin(t * 12) * 0.3 : 0.6
    }
    // Baris "teks" di layar: bergulir pelan saat siaga, cepat saat bekerja.
    bars.current?.children.forEach((c, i) => {
      c.scale.x = 0.3 + 0.65 * Math.abs(Math.sin(t * (active ? 3.2 : 0.5) + i * 1.7))
    })
    if (progress.current) {
      progress.current.visible = active
      progress.current.scale.x = ((t * 0.45) % 1) + 0.02
    }
  })
  return (
    <group position={[0, 0.79, -0.22]}>
      <mesh position={[0, 0.01, 0]} castShadow>
        <boxGeometry args={[0.24, 0.02, 0.16]} />
        <meshStandardMaterial color="#3a3f47" metalness={0.4} roughness={0.4} />
      </mesh>
      <mesh position={[0, 0.1, 0]} castShadow>
        <boxGeometry args={[0.05, 0.18, 0.04]} />
        <meshStandardMaterial color="#3a3f47" metalness={0.4} roughness={0.4} />
      </mesh>
      <RoundedBox args={[0.74, 0.46, 0.04]} radius={0.015} position={[0, 0.38, 0]} castShadow>
        <meshStandardMaterial color="#1b1f25" roughness={0.35} />
      </RoundedBox>
      <mesh position={[0, 0.38, 0.021]}>
        <planeGeometry args={[0.68, 0.4]} />
        <meshStandardMaterial ref={screen} color="#0b1726" emissive="#1e3a5f" emissiveIntensity={0.6} roughness={0.2} />
      </mesh>
      <group ref={bars} position={[-0.29, 0.5, 0.023]}>
        {[0, 1, 2, 3, 4].map((i) => (
          <mesh key={i} position={[0, -i * 0.052, 0]}>
            <planeGeometry args={[0.52, 0.016]} />
            <meshBasicMaterial color="#d7ebff" transparent opacity={0.75} />
          </mesh>
        ))}
      </group>
      <group position={[-0.31, 0.22, 0.024]}>
        <mesh ref={progress} position={[0.31, 0, 0]} visible={false}>
          <planeGeometry args={[0.62, 0.026]} />
          <meshBasicMaterial color="#facc15" />
        </mesh>
      </group>
    </group>
  )
}

function Chair({ color }: { color: string }) {
  return (
    <group position={[0, 0, 0.78]}>
      <RoundedBox args={[0.48, 0.07, 0.46]} radius={0.03} position={[0, 0.46, 0]} castShadow>
        <meshStandardMaterial color={color} roughness={0.8} />
      </RoundedBox>
      <RoundedBox args={[0.46, 0.58, 0.06]} radius={0.03} position={[0, 0.8, 0.22]} castShadow>
        <meshStandardMaterial color={color} roughness={0.8} />
      </RoundedBox>
      <mesh position={[0, 0.22, 0]}>
        <cylinderGeometry args={[0.03, 0.03, 0.44, 10]} />
        <meshStandardMaterial color="#9ca3af" metalness={0.6} roughness={0.3} />
      </mesh>
      <mesh position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.24, 5]} />
        <meshStandardMaterial color="#4b5563" side={THREE.DoubleSide} />
      </mesh>
    </group>
  )
}

/** Meja + monitor + keyboard + mug + kursi, di depan titik duduk (0, 0) -- karakter menghadap -z. */
function Workstation({ accent, mode }: { accent: string; mode: AgentMode | 'admin' }) {
  return (
    <group>
      <group position={[0, 0, -0.75]}>
        <RoundedBox args={[1.7, 0.06, 0.85]} radius={0.02} position={[0, 0.76, 0]} castShadow receiveShadow>
          <meshStandardMaterial color="#e6d3b3" roughness={0.55} />
        </RoundedBox>
        {([[-0.78, -0.35], [0.78, -0.35], [-0.78, 0.35], [0.78, 0.35]] as Vec2[]).map(([lx, lz]) => (
          <mesh key={`${lx}${lz}`} position={[lx, 0.37, lz]} castShadow>
            <boxGeometry args={[0.05, 0.74, 0.05]} />
            <meshStandardMaterial color="#8f7d61" />
          </mesh>
        ))}
        <Monitor accent={accent} mode={mode} />
        <mesh position={[0, 0.8, 0.1]} castShadow>
          <boxGeometry args={[0.48, 0.02, 0.15]} />
          <meshStandardMaterial color="#2f343b" roughness={0.6} />
        </mesh>
        <mesh position={[0.36, 0.8, 0.12]} castShadow>
          <boxGeometry args={[0.07, 0.02, 0.11]} />
          <meshStandardMaterial color="#2f343b" />
        </mesh>
        <mesh position={[-0.6, 0.84, 0.05]} castShadow>
          <cylinderGeometry args={[0.045, 0.04, 0.1, 16]} />
          <meshStandardMaterial color="#ffffff" roughness={0.3} />
        </mesh>
        <mesh position={[0.62, 0.8, -0.18]} rotation={[0, 0.3, 0]} castShadow>
          <boxGeometry args={[0.22, 0.03, 0.3]} />
          <meshStandardMaterial color="#f8fafc" />
        </mesh>
      </group>
      <Chair color={mode === 'admin' ? '#1f2937' : '#374151'} />
    </group>
  )
}

function Plant({ at, scale = 1 }: { at: [number, number, number]; scale?: number }) {
  const leaves = useRef<THREE.Group>(null)
  useFrame(({ clock }) => {
    if (leaves.current) leaves.current.rotation.z = Math.sin(clock.elapsedTime * 0.8 + at[0]) * 0.035
  })
  return (
    <group position={at} scale={scale}>
      <mesh position={[0, 0.2, 0]} castShadow>
        <cylinderGeometry args={[0.2, 0.15, 0.4, 20]} />
        <meshStandardMaterial color="#c9a27a" roughness={0.8} />
      </mesh>
      <group ref={leaves} position={[0, 0.4, 0]}>
        {([[0, 0.22, 0, 0.28], [0.17, 0.38, 0.05, 0.22], [-0.15, 0.42, -0.06, 0.2], [0.02, 0.6, 0, 0.18]] as Array<[number, number, number, number]>).map(([x, y, z, r], i) => (
          <mesh key={i} position={[x, y, z]} castShadow>
            <icosahedronGeometry args={[r, 1]} />
            <meshStandardMaterial color={i % 2 ? '#4d8b4f' : '#5fa15f'} roughness={0.7} flatShading />
          </mesh>
        ))}
      </group>
    </group>
  )
}

function Room() {
  const glass = (
    <meshPhysicalMaterial color="#cfe6f3" transparent opacity={0.2} roughness={0.05} metalness={0.1} depthWrite={false} />
  )
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0.5, 0, 0.25]} receiveShadow>
        <planeGeometry args={[15, 9.5]} />
        <meshStandardMaterial color="#e9dcc6" roughness={0.85} />
      </mesh>
      {Array.from({ length: 14 }, (_, i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[-6.5 + i, 0.002, 0.25]}>
          <planeGeometry args={[0.012, 9.5]} />
          <meshBasicMaterial color="#d6c5a8" />
        </mesh>
      ))}
      {/* Karpet area kerja */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-2.6, 0.004, 0.4]} receiveShadow>
        <planeGeometry args={[6.4, 6.4]} />
        <meshStandardMaterial color="#d9cfc0" roughness={1} />
      </mesh>
      <mesh position={[0.5, 1.6, -4.5]} receiveShadow>
        <boxGeometry args={[15, 3.2, 0.12]} />
        <meshStandardMaterial color="#f1ede6" />
      </mesh>
      <mesh position={[-7, 1.6, 0.25]} receiveShadow>
        <boxGeometry args={[0.12, 3.2, 9.5]} />
        <meshStandardMaterial color="#e7e2d9" />
      </mesh>
      {/* Jendela bercahaya + papan tulis */}
      {[-4.6, -1.6].map((x) => (
        <group key={x} position={[x, 1.9, -4.43]}>
          <mesh>
            <planeGeometry args={[2.2, 1.4]} />
            <meshStandardMaterial color="#e3f3ff" emissive="#bfe3ff" emissiveIntensity={0.7} />
          </mesh>
          <mesh position={[0, 0, 0.005]}>
            <planeGeometry args={[0.04, 1.4]} />
            <meshBasicMaterial color="#ffffff" />
          </mesh>
        </group>
      ))}
      <mesh position={[1.6, 1.7, -4.43]}>
        <planeGeometry args={[1.8, 1.0]} />
        <meshStandardMaterial color="#ffffff" roughness={0.3} />
      </mesh>
      <mesh position={[-6.93, 1.8, 0.8]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[1.4, 0.9]} />
        <meshStandardMaterial color="#cbd5e1" />
      </mesh>
      {/* Ruang kaca admin: dinding samping x=3.6, dinding depan z=0.2 dengan pintu di x 4.7-6.1 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[5.6, 0.003, -2.15]} receiveShadow>
        <planeGeometry args={[4, 4.7]} />
        <meshStandardMaterial color="#dfe7ec" />
      </mesh>
      <mesh position={[3.6, 1.2, -2.15]}>
        <boxGeometry args={[0.04, 2.4, 4.7]} />
        {glass}
      </mesh>
      <mesh position={[4.15, 1.2, 0.2]}>
        <boxGeometry args={[1.1, 2.4, 0.04]} />
        {glass}
      </mesh>
      <mesh position={[6.85, 1.2, 0.2]}>
        <boxGeometry args={[1.5, 2.4, 0.04]} />
        {glass}
      </mesh>
      <mesh position={[5.6, 2.42, 0.2]}>
        <boxGeometry args={[4, 0.05, 0.06]} />
        <meshStandardMaterial color="#8aa0ae" metalness={0.5} />
      </mesh>
      {/* Sofa, rak, dispenser */}
      <RoundedBox args={[1.6, 0.4, 0.7]} radius={0.12} position={[2.2, 0.25, 3.6]} castShadow>
        <meshStandardMaterial color="#8fb3a4" roughness={0.9} />
      </RoundedBox>
      <RoundedBox args={[1.6, 0.5, 0.18]} radius={0.08} position={[2.2, 0.6, 3.95]} castShadow>
        <meshStandardMaterial color="#86a99a" roughness={0.9} />
      </RoundedBox>
      <mesh position={[-6.7, 0.9, -2.6]} castShadow>
        <boxGeometry args={[0.4, 1.8, 1.4]} />
        <meshStandardMaterial color="#c8b08c" />
      </mesh>
      {[0.35, 0.95, 1.5].map((y) => (
        <mesh key={y} position={[-6.48, y, -2.6]} castShadow>
          <boxGeometry args={[0.06, 0.3, 1.1]} />
          <meshStandardMaterial color={y > 1 ? '#7c9cf5' : y > 0.5 ? '#f0a24b' : '#45b39a'} />
        </mesh>
      ))}
      <group position={[-6.5, 0, 3.0]}>
        <mesh position={[0, 0.55, 0]} castShadow>
          <boxGeometry args={[0.4, 1.1, 0.4]} />
          <meshStandardMaterial color="#e5e7eb" />
        </mesh>
        <mesh position={[0, 1.3, 0]} castShadow>
          <cylinderGeometry args={[0.15, 0.15, 0.4, 16]} />
          <meshPhysicalMaterial color="#93c5fd" transparent opacity={0.6} />
        </mesh>
      </group>
      <Plant at={[-6.3, 0, 4.2]} scale={1.2} />
      <Plant at={[0.4, 0, -4]} />
      <Plant at={[7.3, 0, 4.1]} scale={1.1} />
      <Plant at={[7.2, 0, -3.9]} scale={0.8} />
    </group>
  )
}

/* ------------------------------------------------------------------ karakter */

type Joint = THREE.Group | null
type Rig = {
  root: Joint
  body: Joint
  head: Joint
  lShoulder: Joint
  rShoulder: Joint
  lElbow: Joint
  rElbow: Joint
  lHip: Joint
  rHip: Joint
  lKnee: Joint
  rKnee: Joint
}

/** Rute: mundur dari kursi, menyusuri lorong samping, lewat depan ruang kaca, masuk pintu, berhenti di depan meja admin. */
export function deliveryPath(seat: Vec2): Vec2[] {
  const back = seat[1] + 0.7
  return [seat, [seat[0], back], [CORRIDOR_X, back], [CORRIDOR_X, DOOR_Z], [ADMIN_SPOT[0], DOOR_Z], ADMIN_SPOT]
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
/** Sudut putar Y agar karakter (menghadap -z) menghadap arah gerak. */
const yawOf = (dir: Vec2) => Math.atan2(-dir[0], -dir[1])
function lerpAngle(a: number, b: number, k: number) {
  let d = b - a
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return a + d * k
}

type PersonProps = {
  look: Look
  mode: AgentMode
  label: string
  name: string
  seat: Vec2
  phase: number
  isAdmin?: boolean
  /** Titik duduk dipakai sebagai posisi dunia (agen); admin diletakkan oleh group induknya. */
  world?: boolean
}

function Person({ look, mode, label, name, seat, phase, isAdmin = false, world = true }: PersonProps) {
  const root = useRef<THREE.Group>(null)
  const body = useRef<THREE.Group>(null)
  const head = useRef<THREE.Group>(null)
  const lShoulder = useRef<THREE.Group>(null)
  const rShoulder = useRef<THREE.Group>(null)
  const lElbow = useRef<THREE.Group>(null)
  const rElbow = useRef<THREE.Group>(null)
  const lHip = useRef<THREE.Group>(null)
  const rHip = useRef<THREE.Group>(null)
  const lKnee = useRef<THREE.Group>(null)
  const rKnee = useRef<THREE.Group>(null)
  const paper = useRef<THREE.Mesh>(null)
  const cup = useRef<THREE.Mesh>(null)
  const ring = useRef<THREE.Mesh>(null)
  const ringMat = useRef<THREE.MeshBasicMaterial>(null)
  const badge = useRef<THREE.Group>(null)
  const badgeMat = useRef<THREE.MeshStandardMaterial>(null)
  const envelope = useRef<THREE.Group>(null)
  const walk = useRef<number | null>(null)
  const envStart = useRef<number | null>(null)
  const now = useRef(0)
  const path = useMemo(() => deliveryPath(seat), [seat])
  const len = useMemo(() => pathLength(path), [path])
  const back = useMemo(() => [...path].reverse() as Vec2[], [path])

  useEffect(() => {
    if (mode === 'handoff' && !isAdmin && walk.current === null) walk.current = now.current
    if (mode === 'done' && label === 'Balasan terkirim ke tamu') envStart.current = now.current
  }, [mode, label, isAdmin])

  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    now.current = t
    const r: Rig = {
      root: root.current,
      body: body.current,
      head: head.current,
      lShoulder: lShoulder.current,
      rShoulder: rShoulder.current,
      lElbow: lElbow.current,
      rElbow: rElbow.current,
      lHip: lHip.current,
      rHip: rHip.current,
      lKnee: lKnee.current,
      rKnee: rKnee.current,
    }
    if (!r.root || !r.body || !r.head || !r.lShoulder || !r.rShoulder || !r.lElbow || !r.rElbow || !r.lHip || !r.rHip || !r.lKnee || !r.rKnee) return
    const tt = t + phase

    // --- jalan mengantar hasil (berjalan terus walau status sudah kembali siaga)
    let walking = false
    let giving = false
    let pos: Vec2 = world ? seat : [0, 0]
    let yaw = 0
    if (walk.current !== null) {
      const e = t - walk.current
      const goS = len / WALK_SPEED
      if (e < goS) {
        const d = pointAt(path, e * WALK_SPEED)
        pos = d.pos
        yaw = yawOf(d.dir)
        walking = true
      } else if (e < goS + GIVE_S) {
        pos = ADMIN_SPOT
        giving = true
      } else if (e < goS * 2 + GIVE_S) {
        const d = pointAt(back, (e - goS - GIVE_S) * WALK_SPEED)
        pos = d.pos
        yaw = yawOf(d.dir)
        walking = true
      } else {
        walk.current = null
      }
    }
    r.root.position.set(pos[0], 0, pos[1])
    r.root.rotation.y = lerpAngle(r.root.rotation.y, yaw, 0.2)

    // --- kaki: duduk (paha ke depan, betis ke bawah), berdiri, atau melangkah
    const seated = !walking && !giving
    const stride = Math.sin(tt * STEP_RATE)
    r.body.position.y = seated ? 0.49 : 0.84 + (walking ? Math.abs(stride) * 0.035 : 0)
    if (seated) {
      r.lHip.rotation.x = r.rHip.rotation.x = Math.PI / 2
      r.lKnee.rotation.x = r.rKnee.rotation.x = -Math.PI / 2
    } else if (walking) {
      r.lHip.rotation.x = stride * 0.5
      r.rHip.rotation.x = -stride * 0.5
      r.lKnee.rotation.x = -Math.max(0, Math.sin(tt * STEP_RATE - Math.PI / 2)) * 0.8
      r.rKnee.rotation.x = -Math.max(0, Math.sin(tt * STEP_RATE + Math.PI / 2)) * 0.8
    } else {
      r.lHip.rotation.x = r.rHip.rotation.x = 0
      r.lKnee.rotation.x = r.rKnee.rotation.x = 0
    }

    // --- lengan & kepala
    let lS = 1.05
    let rS = 1.05
    let lE = 0.55
    let rE = 0.55
    let headYaw = 0
    let headPitch = 0
    let lean = 0
    let drinking = false
    if (walking) {
      lS = -stride * 0.45
      rS = 0.6
      lE = 0.25
      rE = 1.0 // tangan kanan membawa kertas
    } else if (giving) {
      lS = 0.1
      lE = 0.1
      rS = 1.35
      rE = 0.15
      headPitch = 0.1
    } else if (mode === 'error') {
      headYaw = Math.sin(tt * 9) * 0.35
      lS = rS = 0.6
      lE = rE = 1.6 // tangan terangkat, bingung
      lean = -0.05
    } else if (mode === 'done' && !isAdmin) {
      const k = Math.min(1, Math.max(0, Math.sin(tt * 3) * 0.5 + 0.5))
      rS = 2.6 + k * 0.3
      rE = 0.2
      headPitch = -0.15
      lean = -0.08
    } else {
      // Mengetik: cepat saat bekerja, santai saat siaga, dengan aksi siaga bergiliran tiap ±16 detik.
      const fast = mode === 'working' || mode === 'handoff'
      const speed = fast ? 20 : 7
      const amp = fast ? 0.14 : 0.05
      lE = 0.55 + Math.sin(tt * speed) * amp
      rE = 0.55 + Math.sin(tt * speed + Math.PI) * amp
      headPitch = fast ? 0.14 : 0.03
      headYaw = fast ? Math.sin(tt * 0.9) * 0.06 : 0
      lean = fast ? 0.1 : 0.03
      if (!fast) {
        const cycleLen = 16
        const cycle = (tt % cycleLen) / cycleLen
        const which = Math.floor(tt / cycleLen + phase) % 3
        if (cycle > 0.75) {
          const k = Math.sin(((cycle - 0.75) / 0.25) * Math.PI)
          if (which === 0) {
            headYaw = k * 0.7 // menoleh ke rekan
            headPitch = 0
          } else if (which === 1) {
            rS = THREE.MathUtils.lerp(1.05, 2.0, k) // minum kopi
            rE = THREE.MathUtils.lerp(0.55, 2.0, k)
            headPitch = -0.15 * k
            drinking = k > 0.15
          } else {
            lS = rS = THREE.MathUtils.lerp(1.05, 2.95, k) // meregangkan badan
            lE = rE = THREE.MathUtils.lerp(0.55, 0.05, k)
            lean = -0.12 * k
            headPitch = -0.2 * k
          }
        }
      }
    }
    r.lShoulder.rotation.x = THREE.MathUtils.lerp(r.lShoulder.rotation.x, lS, 0.22)
    r.rShoulder.rotation.x = THREE.MathUtils.lerp(r.rShoulder.rotation.x, rS, 0.22)
    r.lElbow.rotation.x = THREE.MathUtils.lerp(r.lElbow.rotation.x, lE, 0.35)
    r.rElbow.rotation.x = THREE.MathUtils.lerp(r.rElbow.rotation.x, rE, 0.35)
    r.head.rotation.y = THREE.MathUtils.lerp(r.head.rotation.y, headYaw, 0.15)
    r.head.rotation.x = THREE.MathUtils.lerp(r.head.rotation.x, headPitch, 0.15)
    r.body.rotation.x = THREE.MathUtils.lerp(r.body.rotation.x, -lean, 0.12)
    r.body.scale.y = 1 + Math.sin(tt * 2.2) * 0.008 // napas
    if (paper.current) paper.current.visible = walking || giving
    if (cup.current) cup.current.visible = drinking

    // --- indikator kerja: cincin lantai + lencana di atas kepala
    const active = mode !== 'idle' && !isAdmin
    if (ring.current && ringMat.current) {
      ring.current.visible = active
      ring.current.scale.setScalar(1 + Math.sin(t * 4) * 0.07)
      ringMat.current.color.set(MODE_COLOR[mode])
      ringMat.current.opacity = 0.4 + Math.sin(t * 4) * 0.15
    }
    if (badge.current && badgeMat.current) {
      badge.current.visible = active
      badge.current.position.y = 1.72 + Math.sin(t * 3) * 0.04
      badge.current.rotation.y = mode === 'working' ? t * 3 : t * 0.8
      badge.current.rotation.x = mode === 'working' ? t * 1.7 : 0
      badgeMat.current.color.set(MODE_COLOR[mode])
      badgeMat.current.emissive.set(MODE_COLOR[mode])
    }
    // --- amplop terbang: balasan bot terkirim ke tamu
    if (envelope.current) {
      const s = envStart.current
      if (s !== null && t - s < 2.4) {
        const k = (t - s) / 2.4
        envelope.current.visible = true
        envelope.current.position.set(Math.sin(k * 6) * 0.15, 1.2 + k * 2.2, -0.95 - k * 0.8)
        envelope.current.rotation.set(0, k * 4, Math.sin(k * 8) * 0.3)
        envelope.current.scale.setScalar(1 - k * 0.5)
      } else {
        envelope.current.visible = false
      }
    }
  })

  return (
    <group ref={root} position={world ? [seat[0], 0, seat[1]] : [0, 0, 0]}>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0]} visible={false}>
        <ringGeometry args={[0.44, 0.58, 48]} />
        <meshBasicMaterial ref={ringMat} transparent opacity={0.4} color="#3b82f6" depthWrite={false} />
      </mesh>
      <group ref={badge} visible={false}>
        <mesh>
          <octahedronGeometry args={[0.07, 0]} />
          <meshStandardMaterial ref={badgeMat} color="#3b82f6" emissive="#3b82f6" emissiveIntensity={0.8} />
        </mesh>
      </group>
      <group ref={body} position={[0, 0.49, 0]}>
        {/* Badan + kerah */}
        <mesh position={[0, 0.32, 0]} castShadow>
          <capsuleGeometry args={[0.17, 0.3, 6, 16]} />
          <meshStandardMaterial color={look.shirt} roughness={0.75} />
        </mesh>
        <mesh position={[0, 0.58, 0]} castShadow>
          <cylinderGeometry args={[0.05, 0.06, 0.08, 12]} />
          <meshStandardMaterial color={look.skin} roughness={0.6} />
        </mesh>
        {/* Kepala */}
        <group ref={head} position={[0, 0.72, 0]}>
          <mesh castShadow>
            <sphereGeometry args={[0.14, 28, 28]} />
            <meshStandardMaterial color={look.skin} roughness={0.55} />
          </mesh>
          <mesh position={[0, 0.03, 0.012]} scale={[1.05, 0.88, 1.05]} castShadow>
            <sphereGeometry args={[0.145, 28, 16, 0, Math.PI * 2, 0, Math.PI / 1.9]} />
            <meshStandardMaterial color={look.hair} roughness={0.9} />
          </mesh>
          {[-0.05, 0.05].map((x) => (
            <mesh key={x} position={[x, 0.0, -0.128]}>
              <sphereGeometry args={[0.017, 10, 10]} />
              <meshStandardMaterial color="#1b1b1b" roughness={0.2} />
            </mesh>
          ))}
          <mesh position={[0, -0.03, -0.137]}>
            <sphereGeometry args={[0.016, 8, 8]} />
            <meshStandardMaterial color={look.skin} roughness={0.6} />
          </mesh>
          {[-1, 1].map((s) => (
            <mesh key={s} position={[s * 0.138, -0.01, 0]}>
              <sphereGeometry args={[0.028, 10, 10]} />
              <meshStandardMaterial color={look.skin} roughness={0.6} />
            </mesh>
          ))}
        </group>
        {/* Lengan */}
        {(['l', 'r'] as const).map((side) => (
          <group key={side} ref={side === 'l' ? lShoulder : rShoulder} position={[side === 'l' ? -0.23 : 0.23, 0.52, 0]}>
            <mesh position={[0, -0.13, 0]} castShadow>
              <capsuleGeometry args={[0.056, 0.18, 4, 10]} />
              <meshStandardMaterial color={look.shirt} roughness={0.75} />
            </mesh>
            <group ref={side === 'l' ? lElbow : rElbow} position={[0, -0.27, 0]}>
              <mesh position={[0, -0.11, 0]} castShadow>
                <capsuleGeometry args={[0.046, 0.16, 4, 10]} />
                <meshStandardMaterial color={look.skin} roughness={0.6} />
              </mesh>
              <mesh position={[0, -0.23, 0]} castShadow>
                <sphereGeometry args={[0.05, 12, 12]} />
                <meshStandardMaterial color={look.skin} roughness={0.6} />
              </mesh>
              {side === 'r' && (
                <>
                  <mesh ref={paper} position={[0, -0.28, -0.06]} rotation={[0.25, 0, 0]} visible={false} castShadow>
                    <boxGeometry args={[0.2, 0.26, 0.012]} />
                    <meshStandardMaterial color="#ffffff" />
                  </mesh>
                  <mesh ref={cup} position={[0, -0.27, -0.05]} visible={false} castShadow>
                    <cylinderGeometry args={[0.045, 0.04, 0.1, 14]} />
                    <meshStandardMaterial color="#ffffff" />
                  </mesh>
                </>
              )}
            </group>
          </group>
        ))}
        {/* Kaki */}
        {(['l', 'r'] as const).map((side) => (
          <group key={side} ref={side === 'l' ? lHip : rHip} position={[side === 'l' ? -0.09 : 0.09, 0.02, 0]}>
            <mesh position={[0, -0.2, 0]} castShadow>
              <capsuleGeometry args={[0.07, 0.24, 4, 10]} />
              <meshStandardMaterial color="#2d3a4f" roughness={0.85} />
            </mesh>
            <group ref={side === 'l' ? lKnee : rKnee} position={[0, -0.42, 0]}>
              <mesh position={[0, -0.19, 0]} castShadow>
                <capsuleGeometry args={[0.06, 0.24, 4, 10]} />
                <meshStandardMaterial color="#2d3a4f" roughness={0.85} />
              </mesh>
              <mesh position={[0, -0.39, -0.05]} castShadow>
                <boxGeometry args={[0.11, 0.07, 0.22]} />
                <meshStandardMaterial color="#1f1f1f" roughness={0.5} />
              </mesh>
            </group>
          </group>
        ))}
      </group>
      <group ref={envelope} visible={false}>
        <mesh castShadow>
          <boxGeometry args={[0.28, 0.18, 0.02]} />
          <meshStandardMaterial color="#fde68a" emissive="#f59e0b" emissiveIntensity={0.5} />
        </mesh>
      </group>
      <Html position={[0, isAdmin ? 1.75 : 2.0, 0]} center zIndexRange={[30, 0]}>
        <div className="pointer-events-none w-max max-w-[150px] rounded-lg border border-line bg-surface/95 px-2 py-1 text-[10px] leading-tight shadow-md sm:max-w-[200px] sm:text-xs">
          <p className="flex items-center gap-1 font-semibold text-ink">
            <span className="inline-block size-1.5 rounded-full" style={{ background: isAdmin ? '#3b5b8c' : MODE_COLOR[mode] }} aria-hidden />
            {name}
            {mode === 'working' && !isAdmin && <TypingDots />}
            {mode === 'done' && !isAdmin && <span className="text-success">✓</span>}
            {mode === 'error' && !isAdmin && <span className="text-danger">!</span>}
          </p>
          <p className="truncate text-ink-muted">{label}</p>
        </div>
      </Html>
    </group>
  )
}

function TypingDots() {
  return (
    <span className="ml-0.5 inline-flex gap-0.5" aria-hidden>
      {[0, 1, 2].map((i) => (
        <span key={i} className="inline-block size-1 animate-bounce rounded-full bg-accent" style={{ animationDelay: `${i * 0.15}s` }} />
      ))}
    </span>
  )
}

/* ------------------------------------------------------------------ adegan */

function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas')
    return Boolean(c.getContext('webgl2') ?? c.getContext('webgl'))
  } catch {
    return false
  }
}

export default function Office3D({ agents }: { agents: Office3DAgent[] }) {
  const [gl] = useState(webglAvailable)
  // Di layar sentuh kamera tidak bisa diputar, supaya geser jari tetap menggulir halaman.
  const [finePointer] = useState(() => typeof window !== 'undefined' && window.matchMedia?.('(pointer: fine)').matches === true)
  if (!gl) {
    return <div className="grid h-full place-items-center p-4 text-center text-sm text-ink-muted">Browser ini tidak mendukung tampilan 3D (WebGL). Status asisten tetap tampil di kartu di bawah.</div>
  }
  return (
    <Canvas shadows dpr={[1, 2]} camera={{ position: [9, 8.6, 11.5], fov: 36 }} gl={{ antialias: true }}>
      <color attach="background" args={['#f3efe8']} />
      <fog attach="fog" args={['#f3efe8', 22, 40]} />
      <hemisphereLight args={['#ffffff', '#d9cbb3', 0.75]} />
      <directionalLight
        position={[6, 11, 7]}
        intensity={1.7}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-10}
        shadow-camera-right={10}
        shadow-camera-top={10}
        shadow-camera-bottom={-10}
        shadow-bias={-0.0004}
      />
      <pointLight position={[-3, 3.2, -3.5]} intensity={5} distance={10} color="#fff1d6" />
      <Room />
      {agents.map((a, i) => (
        <group key={a.key}>
          <group position={[SEATS[a.key][0], 0, SEATS[a.key][1]]}>
            <Workstation accent={a.shirt} mode={a.mode} />
          </group>
          <Person look={a} mode={a.mode} label={a.label} name={a.name} seat={SEATS[a.key]} phase={i * 1.37} />
        </group>
      ))}
      {/* Admin: menghadap pintu ruang kaca */}
      <group position={[ADMIN_SEAT[0], 0, ADMIN_SEAT[1]]} rotation={[0, Math.PI, 0]}>
        <Workstation accent="#3b5b8c" mode="admin" />
        <Person look={{ shirt: '#3b5b8c', hair: '#222222', skin: '#d6a27a' }} mode="idle" label="Ruang Admin" name="Admin" seat={[0, 0]} phase={2.1} isAdmin world={false} />
      </group>
      <ContactShadows position={[0, 0.006, 0]} opacity={0.3} scale={22} blur={2.5} far={4} />
      <OrbitControls
        target={[0.3, 0.6, 0]}
        enabled={finePointer}
        enablePan={false}
        minDistance={8}
        maxDistance={22}
        minPolarAngle={0.45}
        maxPolarAngle={1.25}
        enableDamping
      />
    </Canvas>
  )
}
