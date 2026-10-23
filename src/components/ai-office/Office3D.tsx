'use client'
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { ContactShadows, OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import type { AiAgentKey } from '@/lib/ai-office/activity'
import type { AgentMode } from '@/lib/ai-office/state'
import { ExecutiveDesk, JvtoRoom, Workstation } from './JvtoRoom'
import {
  ADMIN_SEAT,
  ADMIN_SEAT_YAW,
  ADMIN_SPOT,
  AGENT_SEAT_YAW,
  GIVE_S,
  SEATED_BODY_Y,
  SEATS,
  STANDING_BODY_Y,
  WALK_SPEED,
  deliveryPath,
  declutterBubbles,
  pathLength,
  pointAt,
  type BubbleInput,
  type Vec2,
} from './office-layout'

/**
 * Kantor AI versi 3D (WebGL, React Three Fiber; owner 2026-10-23 "buat lebih real 3D"). Dimuat hanya di browser
 * (`next/dynamic` ssr:false dari AiOffice). Semua geometri dibuat di sini -- tidak ada aset luar. Karakter bersendi
 * (kepala, lengan atas/bawah, paha, betis) dianimasikan per frame:
 * - SIAGA: tetap hidup -- mengetik santai, sesekali menoleh, minum kopi, atau meregangkan badan; layar bergulir pelan.
 * - BEKERJA: mengetik cepat, monitor terang + progress bar, cincin bercahaya di lantai, indikator berputar di atas kepala.
 * - SELESAI: tangan terangkat sebentar; balasan bot yang terkirim melepas amplop terbang.
 * - MENGANTAR: berdiri, berjalan membawa kertas ke meja eksekutif, menyerahkannya ke Admin, kembali duduk.
 * - GAGAL: menggeleng, indikator merah.
 * Ruangannya = kantor JVTO sungguhan (`JvtoRoom.tsx`, denah di `office-layout.ts`).
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

type Look = { shirt: string; hair: string; skin: string }

const STEP_RATE = 10

const MODE_COLOR: Record<AgentMode, string> = { idle: '#94a3b8', working: '#3b82f6', done: '#22c55e', handoff: '#f59e0b', error: '#ef4444' }

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
  seat: Vec2
  phase: number
  isAdmin?: boolean
  /** Arah hadap saat duduk (yaw 0 = -z). */
  seatYaw: number
  /** Titik di atas kepala tempat balon nama menunjuk (diproyeksikan oleh `BubbleLayout`). */
  anchorRef: RefObject<THREE.Group | null>
  selected?: boolean
  onSelect?: () => void
}

function Person({ mode, label, look, seat, phase, seatYaw, isAdmin = false, anchorRef, selected = false, onSelect }: PersonProps) {
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
    let pos: Vec2 = seat
    let yaw = seatYaw
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
        yaw = 0 // menghadap Admin di seberang meja
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
    r.body.position.y = seated ? SEATED_BODY_Y : STANDING_BODY_Y + (walking ? Math.abs(stride) * 0.035 : 0)
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
      ring.current.visible = active || selected
      ring.current.scale.setScalar(1 + Math.sin(t * 4) * 0.07)
      ringMat.current.color.set(active ? MODE_COLOR[mode] : '#0ea5e9')
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
    <group
      ref={root}
      position={[seat[0], 0, seat[1]]}
      rotation={[0, seatYaw, 0]}
      onClick={
        onSelect
          ? (e) => {
              e.stopPropagation()
              onSelect()
            }
          : undefined
      }
      onPointerOver={onSelect ? () => (document.body.style.cursor = 'pointer') : undefined}
      onPointerOut={onSelect ? () => (document.body.style.cursor = '') : undefined}
    >
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
      <group ref={body} position={[0, SEATED_BODY_Y, 0]}>
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
          {/* Titik balon nama: menempel di kepala, jadi ikut saat duduk, berdiri, dan berjalan. */}
          <group ref={anchorRef} position={[0, 0.22, 0]} />
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

/* ------------------------------------------------------------------ balon nama */

type BubbleRef = RefObject<HTMLElement | null>

/**
 * Memproyeksikan titik kepala tiap karakter ke layar dan menata balon namanya supaya tidak saling menimpa
 * (`declutterBubbles`); balon yang dinaikkan diberi garis penunjuk (`--stem`). Dipasang PALING AKHIR di kanvas supaya
 * berjalan sesudah karakter bergerak di frame yang sama.
 */
function BubbleLayout({ entries }: { entries: Array<{ key: string; anchor: RefObject<THREE.Group | null>; el: BubbleRef }> }) {
  const v = useMemo(() => new THREE.Vector3(), [])
  const smooth = useRef<Record<string, { left: number; top: number }>>({})
  useFrame(({ camera, size }) => {
    const items: BubbleInput[] = []
    const els: Record<string, HTMLElement> = {}
    for (const e of entries) {
      const el = e.el.current
      const a = e.anchor.current
      if (!el || !a) continue
      v.setFromMatrixPosition(a.matrixWorld).project(camera)
      if (v.z > 1) {
        el.style.setProperty('visibility', 'hidden')
        continue
      }
      els[e.key] = el
      items.push({ key: e.key, x: ((v.x + 1) / 2) * size.width, y: ((1 - v.y) / 2) * size.height, w: el.offsetWidth, h: el.offsetHeight })
    }
    const placed = declutterBubbles(items, { width: size.width })
    for (const [key, p] of Object.entries(placed)) {
      const el = els[key]
      const prev = smooth.current[key] ?? p
      const left = prev.left + (p.left - prev.left) * 0.35
      const top = prev.top + (p.top - prev.top) * 0.35
      smooth.current[key] = { left, top }
      const anchorY = p.top + (el.offsetHeight || 0) + p.stem
      el.style.setProperty('transform', `translate(${left.toFixed(1)}px, ${top.toFixed(1)}px)`)
      el.style.setProperty('--stem', `${Math.max(0, anchorY - (top + el.offsetHeight)).toFixed(1)}px`)
      el.style.setProperty('visibility', 'visible')
    }
  })
  return null
}

/* ------------------------------------------------------------------ adegan */

const CAMERA_POS: [number, number, number] = [3.4, 2.0, 4.3]
const CAMERA_TARGET: [number, number, number] = [-2.0, 1.0, -1.8]

/** Arahkan kamera ke target sekali di awal; di layar sentuh OrbitControls tidak aktif dan tidak melakukannya. */
function LookAt({ target }: { target: [number, number, number] }) {
  const camera = useThree((st) => st.camera)
  useEffect(() => {
    camera.lookAt(...target)
  }, [camera, target])
  return null
}

function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas')
    return Boolean(c.getContext('webgl2') ?? c.getContext('webgl'))
  } catch {
    return false
  }
}

type Office3DProps = { agents: Office3DAgent[]; selected: AiAgentKey | null; onSelect: (key: AiAgentKey) => void }

export default function Office3D({ agents, selected, onSelect }: Office3DProps) {
  const [gl] = useState(webglAvailable)
  // Di layar sentuh kamera tidak bisa diputar, supaya geser jari tetap menggulir halaman.
  const [finePointer] = useState(() => typeof window !== 'undefined' && window.matchMedia?.('(pointer: fine)').matches === true)
  const topik = useRef<HTMLButtonElement>(null)
  const bot = useRef<HTMLButtonElement>(null)
  const booking = useRef<HTMLButtonElement>(null)
  const ringkasan = useRef<HTMLButtonElement>(null)
  const admin = useRef<HTMLDivElement>(null)
  const bubbles: Record<AiAgentKey, RefObject<HTMLButtonElement | null>> = { topik, bot, booking, ringkasan }
  const aTopik = useRef<THREE.Group>(null)
  const aBot = useRef<THREE.Group>(null)
  const aBooking = useRef<THREE.Group>(null)
  const aRingkasan = useRef<THREE.Group>(null)
  const aAdmin = useRef<THREE.Group>(null)
  const anchors: Record<AiAgentKey, RefObject<THREE.Group | null>> = { topik: aTopik, bot: aBot, booking: aBooking, ringkasan: aRingkasan }
  const bubbleEntries = [
    ...agents.map((a) => ({ key: a.key, anchor: anchors[a.key], el: bubbles[a.key] as BubbleRef })),
    { key: 'admin', anchor: aAdmin, el: admin as BubbleRef },
  ]
  useEffect(() => () => void (document.body.style.cursor = ''), [])
  if (!gl) {
    return <div className="grid h-full place-items-center p-4 text-center text-sm text-ink-muted">Browser ini tidak mendukung tampilan 3D (WebGL). Status asisten tetap tampil di kartu di bawah.</div>
  }
  return (
    <div className="relative h-full w-full">
      {/* Kamera setinggi mata dari pojok terbuka, seperti foto kantor yang dikirim owner. */}
      <Canvas shadows dpr={[1, 2]} camera={{ position: CAMERA_POS, fov: 58, near: 0.1, far: 60 }} gl={{ antialias: true }}>
        <color attach="background" args={['#2a2c30']} />
        <LookAt target={CAMERA_TARGET} />
        <hemisphereLight args={['#fff8ee', '#8a7a66', 0.85]} />
        <ambientLight intensity={0.25} />
        <directionalLight
          position={[2.5, 7, 4]}
          intensity={1.1}
          castShadow
          shadow-mapSize-width={2048}
          shadow-mapSize-height={2048}
          shadow-camera-left={-7}
          shadow-camera-right={7}
          shadow-camera-top={7}
          shadow-camera-bottom={-7}
          shadow-bias={-0.0004}
        />
        {/* Lampu sorot plafon (hangat) + lampu bulat (sejuk) */}
        {([[-3.2, -1.4], [-3.2, 2.2], [2.2, -2.6], [1.8, 1.8]] as Vec2[]).map(([x, z]) => (
          <pointLight key={`${x}${z}`} position={[x, 2.8, z]} intensity={2.4} distance={5.5} decay={1.6} color="#ffe9c7" />
        ))}
        <pointLight position={[-0.6, 2.7, 0.2]} intensity={3} distance={7} decay={1.5} color="#e3eeff" />
        <JvtoRoom />
        {agents.map((a, i) => (
          <group key={a.key}>
            <group position={[SEATS[a.key][0], 0, SEATS[a.key][1]]} rotation={[0, AGENT_SEAT_YAW, 0]}>
              <Workstation accent={a.shirt} mode={a.mode} lamp={a.key === 'booking'} />
            </group>
            <Person
              look={a}
              mode={a.mode}
              label={a.label}
              seat={SEATS[a.key]}
              seatYaw={AGENT_SEAT_YAW}
              phase={i * 1.37}
              anchorRef={anchors[a.key]}
              selected={selected === a.key}
              onSelect={() => onSelect(a.key)}
            />
          </group>
        ))}
        {/* Admin di meja eksekutif, membelakangi dinding hitam ber-TV, menghadap ruangan */}
        <group position={[ADMIN_SEAT[0], 0, ADMIN_SEAT[1]]} rotation={[0, ADMIN_SEAT_YAW, 0]}>
          <ExecutiveDesk />
        </group>
        <Person
          look={{ shirt: '#3b5b8c', hair: '#222222', skin: '#d6a27a' }}
          mode="idle"
          label="Meja Admin"
          seat={ADMIN_SEAT}
          seatYaw={ADMIN_SEAT_YAW}
          phase={2.1}
          isAdmin
          anchorRef={aAdmin}
        />
        <ContactShadows position={[-0.5, 0.006, 0]} opacity={0.35} scale={12} blur={2.2} far={1.2} />
        <OrbitControls
          target={CAMERA_TARGET}
          enabled={finePointer}
          enablePan={false}
          minDistance={2.5}
          maxDistance={12}
          minPolarAngle={0.35}
          maxPolarAngle={1.52}
          minAzimuthAngle={0.05}
          maxAzimuthAngle={1.5}
          enableDamping
        />
        <BubbleLayout entries={bubbleEntries} />
      </Canvas>
      {/* Balon nama: DOM biasa di atas kanvas, bisa diklik untuk membuka obrolan dengan asisten itu. */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {agents.map((a) => (
          <button
            key={a.key}
            ref={bubbles[a.key]}
            type="button"
            onClick={() => onSelect(a.key)}
            aria-label={`Buka obrolan dengan ${a.name}`}
            aria-pressed={selected === a.key}
            style={{ visibility: 'hidden' }}
            className={`focus-ring pointer-events-auto absolute left-0 top-0 w-max max-w-[150px] rounded-lg border bg-surface/95 px-2 py-1 text-left text-[10px] leading-tight shadow-md hover:border-accent sm:max-w-[210px] sm:text-xs ${
              selected === a.key ? 'border-accent ring-2 ring-accent/40' : 'border-line'
            }`}
          >
            <span className="flex items-center gap-1 font-semibold text-ink">
              <span className="inline-block size-1.5 rounded-full" style={{ background: MODE_COLOR[a.mode] }} aria-hidden />
              {a.name}
              {a.mode === 'working' && <TypingDots />}
              {a.mode === 'done' && <span className="text-success">✓</span>}
              {a.mode === 'error' && <span className="text-danger">!</span>}
            </span>
            {/* Siaga = cukup nama (status lengkap ada di kartu bawah); label tugas tampil saat bekerja atau dipilih. */}
            {(a.mode !== 'idle' || selected === a.key) && <span className="block truncate text-ink-muted">{a.label}</span>}
            <span aria-hidden className="pointer-events-none absolute left-1/2 top-full w-px bg-ink-subtle/70" style={{ height: 'var(--stem, 0px)' }} />
          </button>
        ))}
        <div ref={admin} style={{ visibility: 'hidden' }} className="absolute left-0 top-0 w-max rounded-lg border border-line bg-surface/95 px-2 py-1 text-[10px] leading-tight shadow-md sm:text-xs">
          <span className="flex items-center gap-1 font-semibold text-ink">
            <span className="inline-block size-1.5 rounded-full bg-navy" aria-hidden />
            Admin
          </span>
          <span aria-hidden className="pointer-events-none absolute left-1/2 top-full w-px bg-ink-subtle/70" style={{ height: 'var(--stem, 0px)' }} />
        </div>
      </div>
    </div>
  )
}
