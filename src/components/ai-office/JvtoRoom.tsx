'use client'
import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { RoundedBox } from '@react-three/drei'
import * as THREE from 'three'
import type { AgentMode } from '@/lib/ai-office/state'
import { BAR_STOOL, CHAIR_Z, DESK_ROW_Z, ROOM, SEAT_TOP, TV_X, type Vec2 } from './office-layout'

/**
 * Ruang kantor JVTO sungguhan (foto owner 2026-10-23) untuk Kantor AI: dinding abu tua + dinding hitam ber-TV logo JVTO,
 * plafon papan putih dengan list kayu cokelat, lampu sorot + lampu bulat, lantai parket terang, sofa kulit hitam berbantal
 * oranye, meja marmer putih di atas karpet abu, meja-meja hitam di bawah jendela berkerai, loker merah-putih di pojok,
 * pintu ke ruang belakang, meja eksekutif dengan lampu hijau, kursi bar, kipas berdiri. Semua geometri & tekstur dibuat
 * di kode (CanvasTexture) -- tidak ada aset luar.
 *
 * Dinding/plafon berupa bidang satu sisi yang menghadap ke dalam: dari luar (kamera diputar) bidang itu tidak tergambar,
 * jadi isi ruangan tidak pernah tertutup.
 */

/* ------------------------------------------------------------------ tekstur */

function seeded(seed: number) {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void, repeat?: [number, number]) {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (ctx) draw(ctx)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  if (repeat) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping
    tex.repeat.set(repeat[0], repeat[1])
  }
  return tex
}

/** Parket kayu terang: papan berselang-seling dengan sedikit variasi warna dan serat. */
function oakFloor() {
  const rand = seeded(7)
  return canvasTexture(
    1024,
    1024,
    (ctx) => {
      const rowH = 64
      for (let y = 0; y < 1024; y += rowH) {
        let x = -Math.floor(rand() * 300)
        while (x < 1024) {
          const len = 260 + Math.floor(rand() * 260)
          const l = 66 + rand() * 8
          ctx.fillStyle = `hsl(${33 + rand() * 4}, ${42 + rand() * 10}%, ${l}%)`
          ctx.fillRect(x, y, len, rowH)
          ctx.strokeStyle = `hsla(30, 40%, ${l - 14}%, 0.25)`
          ctx.lineWidth = 1
          for (let g = 0; g < 5; g++) {
            const gy = y + 8 + rand() * (rowH - 16)
            ctx.beginPath()
            ctx.moveTo(x, gy)
            ctx.bezierCurveTo(x + len * 0.3, gy + rand() * 6 - 3, x + len * 0.7, gy + rand() * 6 - 3, x + len, gy)
            ctx.stroke()
          }
          ctx.fillStyle = 'rgba(90,60,30,0.35)'
          ctx.fillRect(x, y, 2, rowH)
          x += len
        }
        ctx.fillStyle = 'rgba(90,60,30,0.3)'
        ctx.fillRect(0, y, 1024, 2)
      }
    },
    [3, 3]
  )
}

/** Plafon papan putih (lambersering) dengan alur tipis. */
function ceilingPlanks() {
  return canvasTexture(
    256,
    256,
    (ctx) => {
      ctx.fillStyle = '#f4f3ef'
      ctx.fillRect(0, 0, 256, 256)
      for (let x = 0; x < 256; x += 32) {
        ctx.fillStyle = '#c9c6bf'
        ctx.fillRect(x, 0, 2, 256)
        ctx.fillStyle = 'rgba(255,255,255,0.8)'
        ctx.fillRect(x + 2, 0, 2, 256)
      }
    },
    [5, 5]
  )
}

/** Karpet abu kebiruan bermotif klasik dengan bingkai. */
function rugPattern() {
  const rand = seeded(11)
  return canvasTexture(512, 640, (ctx) => {
    ctx.fillStyle = '#8b9696'
    ctx.fillRect(0, 0, 512, 640)
    ctx.strokeStyle = '#6c7878'
    ctx.lineWidth = 14
    ctx.strokeRect(18, 18, 476, 604)
    ctx.strokeStyle = '#a9b3b1'
    ctx.lineWidth = 4
    ctx.strokeRect(42, 42, 428, 556)
    for (let i = 0; i < 900; i++) {
      ctx.fillStyle = rand() > 0.5 ? 'rgba(170,182,180,0.55)' : 'rgba(96,110,110,0.55)'
      const x = 50 + rand() * 412
      const y = 50 + rand() * 540
      ctx.beginPath()
      ctx.ellipse(x, y, 3 + rand() * 6, 2 + rand() * 4, rand() * Math.PI, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.strokeStyle = 'rgba(200,208,206,0.6)'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.ellipse(256, 320, 120, 170, 0, 0, Math.PI * 2)
    ctx.stroke()
  })
}

/**
 * Logo resmi Java Volcano Tour Operator (salinan `javavolcano-touroperator/public/assets/img/logo512.png`; desainnya sama
 * dengan berkas yang dikirim owner, resolusi lebih tinggi). Latar PNG transparan -- diperiksa 2026-10-23: 0 piksel putih buram.
 */
export const JVTO_LOGO_URL = '/brand/jvto-logo.png'

/**
 * Layar TV di dinding hitam: logo resmi JVTO di atas latar terang, seperti TV di kantor (foto owner 2026-10-23). Latar
 * digambar langsung; logonya digambar begitu berkas termuat (gagal muat = layar terang polos, tanpa galat).
 */
function jvtoLogo() {
  const paintBackground = (ctx: CanvasRenderingContext2D) => {
    const g = ctx.createLinearGradient(0, 0, 640, 360)
    // Biru muda seperti layar TV di foto kantor -- bukan putih.
    g.addColorStop(0, '#dce9fb')
    g.addColorStop(1, '#a9c6ee')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 640, 360)
  }
  const tex = canvasTexture(640, 360, paintBackground)
  const img = new Image()
  img.onload = () => {
    const canvas = tex.image as HTMLCanvasElement
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    paintBackground(ctx)
    const size = 330
    ctx.drawImage(img, (640 - size) / 2, (360 - size) / 2, size, size)
    tex.needsUpdate = true
  }
  img.src = JVTO_LOGO_URL
  return tex
}

function textPlate(text: string, bg: string, fg: string) {
  return canvasTexture(512, 192, (ctx) => {
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, 512, 192)
    ctx.strokeStyle = fg
    ctx.lineWidth = 8
    ctx.strokeRect(14, 14, 484, 164)
    ctx.fillStyle = fg
    ctx.font = 'bold 76px Georgia, serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, 256, 100)
  })
}

function sunsetPhoto() {
  return canvasTexture(256, 256, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 0, 256)
    g.addColorStop(0, '#2b3a67')
    g.addColorStop(0.5, '#f08a4b')
    g.addColorStop(0.7, '#f6c56b')
    g.addColorStop(1, '#1d2433')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 256, 256)
    ctx.fillStyle = '#1b1f2a'
    ctx.beginPath()
    ctx.moveTo(0, 200)
    ctx.lineTo(70, 150)
    ctx.lineTo(120, 175)
    ctx.lineTo(180, 120)
    ctx.lineTo(256, 190)
    ctx.lineTo(256, 256)
    ctx.lineTo(0, 256)
    ctx.fill()
  })
}

function useTextures() {
  const tex = useMemo(
    () => ({
      floor: oakFloor(),
      ceiling: ceilingPlanks(),
      rug: rugPattern(),
      logo: jvtoLogo(),
      indonesia: textPlate('INDONESIA', '#d9c8a5', '#5b3a22'),
      sunset: sunsetPhoto(),
      poster: textPlate('BROMO', '#111214', '#e8e8e8'),
    }),
    []
  )
  useEffect(() => () => Object.values(tex).forEach((t) => t.dispose()), [tex])
  return tex
}

/* ------------------------------------------------------------------ meja agen */

/** Lebar area teks di layar monitor (layar 0,65; sisa 0,05 jadi margin kiri-kanan). */
export const SCREEN_TEXT_W = 0.56

export function Monitor({ accent, mode }: { accent: string; mode: AgentMode | 'admin' }) {
  const bars = useRef<THREE.Group>(null)
  const progress = useRef<THREE.Group>(null)
  const screen = useRef<THREE.MeshStandardMaterial>(null)
  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    const active = mode === 'working'
    if (screen.current) {
      screen.current.emissive.set(mode === 'error' ? '#b91c1c' : mode === 'done' ? '#15803d' : active ? accent : '#1e3a5f')
      screen.current.emissiveIntensity = active ? 1.3 + Math.sin(t * 6) * 0.2 : mode === 'error' ? 1.1 + Math.sin(t * 12) * 0.3 : 0.7
    }
    // Baris "teks" di layar: bergulir pelan saat siaga, cepat saat bekerja.
    bars.current?.children.forEach((c, i) => {
      c.scale.x = 0.3 + 0.7 * Math.abs(Math.sin(t * (active ? 3.2 : 0.5) + i * 1.7))
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
        <meshStandardMaterial color="#202226" metalness={0.4} roughness={0.4} />
      </mesh>
      <mesh position={[0, 0.1, 0]} castShadow>
        <boxGeometry args={[0.05, 0.18, 0.04]} />
        <meshStandardMaterial color="#202226" metalness={0.4} roughness={0.4} />
      </mesh>
      <RoundedBox args={[0.7, 0.44, 0.04]} radius={0.012} position={[0, 0.38, 0]} castShadow>
        <meshStandardMaterial color="#121316" roughness={0.35} />
      </RoundedBox>
      <mesh position={[0, 0.38, 0.021]}>
        <planeGeometry args={[0.65, 0.38]} />
        <meshStandardMaterial ref={screen} color="#0b1726" emissive="#1e3a5f" emissiveIntensity={0.7} roughness={0.2} />
      </mesh>
      {/* Baris "teks": tiap baris berpangkal di tepi kiri layar (group di x kiri, mesh digeser setengah lebarnya), jadi
          skala hanya memanjang ke kanan dan tidak pernah keluar dari bingkai (layar 0,65 lebar: -0.325..0.325). */}
      <group ref={bars} position={[-SCREEN_TEXT_W / 2, 0.49, 0.023]}>
        {[0, 1, 2, 3, 4].map((i) => (
          <group key={i} position={[0, -i * 0.05, 0]}>
            <mesh position={[SCREEN_TEXT_W / 2, 0, 0]}>
              <planeGeometry args={[SCREEN_TEXT_W, 0.015]} />
              <meshBasicMaterial color="#d7ebff" transparent opacity={0.75} />
            </mesh>
          </group>
        ))}
      </group>
      <group ref={progress} position={[-SCREEN_TEXT_W / 2, 0.24, 0.024]} visible={false}>
        <mesh position={[SCREEN_TEXT_W / 2, 0, 0]}>
          <planeGeometry args={[SCREEN_TEXT_W, 0.026]} />
          <meshBasicMaterial color="#facc15" />
        </mesh>
      </group>
    </group>
  )
}

/** Kursi kantor jaring hitam; dudukan tepat di bawah pinggul (CHAIR_Z), sandaran di belakang punggung. */
function OfficeChair({ executive = false }: { executive?: boolean }) {
  const backH = executive ? 0.85 : 0.58
  return (
    <group position={[0, 0, CHAIR_Z]}>
      <RoundedBox args={executive ? [0.56, 0.08, 0.52] : [0.48, 0.06, 0.46]} radius={0.025} position={[0, SEAT_TOP - 0.03, 0]} castShadow>
        <meshStandardMaterial color="#17181b" roughness={executive ? 0.45 : 0.8} />
      </RoundedBox>
      <RoundedBox args={[executive ? 0.56 : 0.46, backH, executive ? 0.1 : 0.05]} radius={0.03} position={[0, SEAT_TOP + 0.03 + backH / 2, 0.24]} castShadow>
        <meshStandardMaterial color="#17181b" roughness={executive ? 0.45 : 0.85} />
      </RoundedBox>
      <mesh position={[0, SEAT_TOP / 2, 0]}>
        <cylinderGeometry args={[0.03, 0.03, SEAT_TOP - 0.06, 10]} />
        <meshStandardMaterial color="#2b2d31" metalness={0.6} roughness={0.3} />
      </mesh>
      {[0, 1, 2, 3, 4].map((i) => (
        <mesh key={i} position={[Math.cos((i * 2 * Math.PI) / 5) * 0.14, 0.04, Math.sin((i * 2 * Math.PI) / 5) * 0.14]} rotation={[0, (-i * 2 * Math.PI) / 5, 0]} castShadow>
          <boxGeometry args={[0.28, 0.03, 0.04]} />
          <meshStandardMaterial color="#1b1c1f" />
        </mesh>
      ))}
    </group>
  )
}

/** Meja hitam + monitor + keyboard + mug + kursi, di depan titik duduk (0, 0) -- karakter menghadap -z. */
export function Workstation({ accent, mode, lamp = false }: { accent: string; mode: AgentMode; lamp?: boolean }) {
  return (
    <group>
      <group position={[0, 0, -0.75]}>
        <mesh position={[0, 0.76, 0]} castShadow receiveShadow>
          <boxGeometry args={[1.35, 0.04, 0.8]} />
          <meshStandardMaterial color="#1c1d20" roughness={0.45} />
        </mesh>
        {([[-0.63, -0.35], [0.63, -0.35], [-0.63, 0.35], [0.63, 0.35]] as Vec2[]).map(([lx, lz]) => (
          <mesh key={`${lx}${lz}`} position={[lx, 0.37, lz]} castShadow>
            <boxGeometry args={[0.04, 0.74, 0.04]} />
            <meshStandardMaterial color="#111214" metalness={0.5} roughness={0.4} />
          </mesh>
        ))}
        <Monitor accent={accent} mode={mode} />
        <mesh position={[0, 0.79, 0.22]} castShadow>
          <boxGeometry args={[0.46, 0.02, 0.14]} />
          <meshStandardMaterial color="#2a2c30" roughness={0.6} />
        </mesh>
        <mesh position={[0.34, 0.79, 0.24]} castShadow>
          <boxGeometry args={[0.07, 0.02, 0.11]} />
          <meshStandardMaterial color="#2a2c30" />
        </mesh>
        <mesh position={[-0.5, 0.83, 0.12]} castShadow>
          <cylinderGeometry args={[0.045, 0.04, 0.1, 16]} />
          <meshStandardMaterial color="#f5f5f5" roughness={0.3} />
        </mesh>
        {lamp && <DeskLamp />}
      </group>
      <OfficeChair />
    </group>
  )
}

function DeskLamp() {
  return (
    <group position={[0.52, 0.78, -0.2]}>
      <mesh position={[0, 0.01, 0]}>
        <cylinderGeometry args={[0.07, 0.08, 0.02, 20]} />
        <meshStandardMaterial color="#f2f2f2" />
      </mesh>
      <mesh position={[0, 0.2, 0]} rotation={[0, 0, 0.25]}>
        <cylinderGeometry args={[0.012, 0.012, 0.4, 8]} />
        <meshStandardMaterial color="#f2f2f2" />
      </mesh>
      <mesh position={[-0.08, 0.4, 0.06]} rotation={[0.9, 0, 0]}>
        <coneGeometry args={[0.06, 0.1, 16, 1, true]} />
        <meshStandardMaterial color="#f2f2f2" emissive="#fff6da" emissiveIntensity={0.4} side={THREE.DoubleSide} />
      </mesh>
    </group>
  )
}

/* ------------------------------------------------------------------ meja eksekutif admin */

/** Meja eksekutif abu tua dengan panel depan, lampu bankir hijau, monitor, map; karakter menghadap -z dari (0, 0). */
export function ExecutiveDesk() {
  return (
    <group>
      <group position={[0, 0, -0.75]}>
        <mesh position={[0, 0.76, 0]} castShadow receiveShadow>
          <boxGeometry args={[2.2, 0.06, 0.9]} />
          <meshStandardMaterial color="#4a4d52" roughness={0.5} />
        </mesh>
        {/* Panel depan (sisi tamu) + dua kabinet */}
        <mesh position={[0, 0.4, -0.42]} castShadow receiveShadow>
          <boxGeometry args={[2.1, 0.72, 0.04]} />
          <meshStandardMaterial color="#3a3d42" roughness={0.6} />
        </mesh>
        {[-0.8, 0.8].map((x) => (
          <mesh key={x} position={[x, 0.37, -0.05]} castShadow>
            <boxGeometry args={[0.45, 0.74, 0.72]} />
            <meshStandardMaterial color="#3d4045" roughness={0.6} />
          </mesh>
        ))}
        <Monitor accent="#3b5b8c" mode="admin" />
        {/* Lampu bankir hijau */}
        <group position={[-0.6, 0.79, -0.15]}>
          <mesh position={[0, 0.01, 0]}>
            <cylinderGeometry args={[0.08, 0.09, 0.02, 20]} />
            <meshStandardMaterial color="#b08a3e" metalness={0.8} roughness={0.3} />
          </mesh>
          <mesh position={[0, 0.15, 0]}>
            <cylinderGeometry args={[0.012, 0.012, 0.28, 8]} />
            <meshStandardMaterial color="#b08a3e" metalness={0.8} roughness={0.3} />
          </mesh>
          <mesh position={[0, 0.3, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.07, 0.07, 0.3, 20, 1, true, 0, Math.PI]} />
            <meshStandardMaterial color="#1f9d55" emissive="#22c55e" emissiveIntensity={0.35} side={THREE.DoubleSide} roughness={0.3} />
          </mesh>
          <pointLight position={[0, 0.24, 0]} intensity={0.6} distance={1.4} color="#fff2c4" />
        </group>
        <mesh position={[0.55, 0.8, 0.15]} rotation={[0, 0.25, 0]} castShadow>
          <boxGeometry args={[0.3, 0.02, 0.22]} />
          <meshStandardMaterial color="#c0392b" />
        </mesh>
        <mesh position={[0.6, 0.82, 0.15]} rotation={[0, -0.1, 0]}>
          <boxGeometry args={[0.24, 0.01, 0.32]} />
          <meshStandardMaterial color="#fafafa" />
        </mesh>
        <mesh position={[0, 0.79, 0.22]} castShadow>
          <boxGeometry args={[0.46, 0.02, 0.14]} />
          <meshStandardMaterial color="#2a2c30" />
        </mesh>
      </group>
      <OfficeChair executive />
    </group>
  )
}

/* ------------------------------------------------------------------ perabot ruangan */

function Sofa() {
  const leather = <meshStandardMaterial color="#1b1c1f" roughness={0.38} metalness={0.05} />
  return (
    <group position={[ROOM.minX + 0.48, 0, 3.3]} rotation={[0, Math.PI / 2, 0]}>
      <RoundedBox args={[2.2, 0.42, 0.9]} radius={0.08} position={[0, 0.28, 0]} castShadow receiveShadow>
        {leather}
      </RoundedBox>
      <RoundedBox args={[2.2, 0.5, 0.22]} radius={0.08} position={[0, 0.62, -0.36]} castShadow>
        {leather}
      </RoundedBox>
      {[-1.04, 1.04].map((x) => (
        <RoundedBox key={x} args={[0.2, 0.62, 0.9]} radius={0.07} position={[x, 0.36, 0]} castShadow>
          {leather}
        </RoundedBox>
      ))}
      {[-0.65, -0.2].map((x, i) => (
        <RoundedBox key={x} args={[0.48, 0.42, 0.12]} radius={0.06} position={[x, 0.62, -0.18]} rotation={[-0.25, 0, i ? 0.15 : -0.1]} castShadow>
          <meshStandardMaterial color="#c4502f" roughness={0.9} />
        </RoundedBox>
      ))}
    </group>
  )
}

function CoffeeTable() {
  return (
    <group position={[-3.45, 0, 3.3]}>
      <mesh position={[0, 0.46, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.95, 0.04, 0.95]} />
        <meshPhysicalMaterial color="#f1f0ee" roughness={0.15} clearcoat={0.8} />
      </mesh>
      {([[-0.42, -0.42], [0.42, -0.42], [-0.42, 0.42], [0.42, 0.42]] as Vec2[]).map(([x, z]) => (
        <mesh key={`${x}${z}`} position={[x, 0.22, z]} castShadow>
          <boxGeometry args={[0.035, 0.44, 0.035]} />
          <meshStandardMaterial color="#111" />
        </mesh>
      ))}
      <mesh position={[0, 0.12, 0]}>
        <boxGeometry args={[0.88, 0.02, 0.88]} />
        <meshStandardMaterial color="#141414" />
      </mesh>
    </group>
  )
}

function RedLocker() {
  return (
    <group position={[ROOM.minX + 0.25, 0, -4.15]}>
      <mesh position={[0, 0.88, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.46, 1.76, 0.5]} />
        <meshStandardMaterial color="#f3f3f3" roughness={0.4} />
      </mesh>
      {[0, 1, 2, 3].map((i) => (
        <mesh key={i} position={[0.232, 0.25 + i * 0.42, 0]}>
          <boxGeometry args={[0.01, 0.36, 0.42]} />
          <meshStandardMaterial color="#c8202a" roughness={0.35} />
        </mesh>
      ))}
    </group>
  )
}

function BarStool() {
  return (
    <group position={[BAR_STOOL[0], 0, BAR_STOOL[1]]}>
      <mesh position={[0, 0.66, 0]} castShadow>
        <cylinderGeometry args={[0.17, 0.17, 0.05, 24]} />
        <meshStandardMaterial color="#5b3a22" roughness={0.6} />
      </mesh>
      {[0, 1, 2].map((i) => {
        const a = (i * 2 * Math.PI) / 3
        return (
          <mesh key={i} position={[Math.cos(a) * 0.1, 0.33, Math.sin(a) * 0.1]} rotation={[Math.sin(a) * 0.15, 0, -Math.cos(a) * 0.15]} castShadow>
            <cylinderGeometry args={[0.018, 0.022, 0.66, 8]} />
            <meshStandardMaterial color="#4a2f1c" />
          </mesh>
        )
      })}
      <mesh position={[0, 0.25, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.13, 0.012, 6, 24]} />
        <meshStandardMaterial color="#4a2f1c" />
      </mesh>
    </group>
  )
}

/** Kipas berdiri; baling-balingnya berputar terus (detail hidup seperti di foto). */
function StandingFan() {
  const blades = useRef<THREE.Group>(null)
  const head = useRef<THREE.Group>(null)
  useFrame(({ clock }, dt) => {
    if (blades.current) blades.current.rotation.z += dt * 14
    if (head.current) head.current.rotation.y = 0.9 + Math.sin(clock.elapsedTime * 0.4) * 0.5
  })
  return (
    <group position={[3.2, 0, -0.9]}>
      <mesh position={[0, 0.03, 0]} castShadow>
        <cylinderGeometry args={[0.2, 0.22, 0.05, 24]} />
        <meshStandardMaterial color="#141414" />
      </mesh>
      <mesh position={[0, 0.6, 0]} castShadow>
        <cylinderGeometry args={[0.02, 0.025, 1.15, 10]} />
        <meshStandardMaterial color="#1a1a1a" metalness={0.4} />
      </mesh>
      <group ref={head} position={[0, 1.22, 0]}>
        <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[0.24, 0.24, 0.12, 24, 1, true]} />
          <meshStandardMaterial color="#202020" wireframe />
        </mesh>
        <mesh position={[0, 0, -0.1]}>
          <cylinderGeometry args={[0.07, 0.07, 0.12, 16]} />
          <meshStandardMaterial color="#141414" />
        </mesh>
        <group ref={blades} position={[0, 0, 0.02]}>
          {[0, 1, 2].map((i) => (
            <mesh key={i} rotation={[0, 0, (i * 2 * Math.PI) / 3]} position={[0, 0, 0]}>
              <boxGeometry args={[0.06, 0.4, 0.01]} />
              <meshStandardMaterial color="#2c2c2c" />
            </mesh>
          ))}
        </group>
      </group>
    </group>
  )
}

/* ------------------------------------------------------------------ ruangan */

const GREY_WALL = '#4b4f53'
const BLACK_WALL = '#1a1c20'
const TRIM = '#4a2c1d'
const DOOR_X: Vec2 = [-4.35, -3.45]
const DOOR_H = 2.1

export function JvtoRoom() {
  const tex = useTextures()
  const { minX, maxX, minZ, maxZ, height: H } = ROOM
  const width = maxX - minX
  const depth = maxZ - minZ
  const cx = (minX + maxX) / 2
  const cz = (minZ + maxZ) / 2
  const greyWall = <meshStandardMaterial color={GREY_WALL} roughness={0.9} />
  const blackWall = <meshStandardMaterial color={BLACK_WALL} roughness={0.55} />

  const spots: Array<[number, number]> = [
    [-3.2, -3],
    [-3.2, 0.2],
    [-3.2, 3.2],
    [2.2, -3],
    [0.4, 2.6],
    [2.8, -0.4],
  ]

  return (
    <group>
      {/* Lantai parket */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, 0, cz]} receiveShadow>
        <planeGeometry args={[width, depth]} />
        <meshStandardMaterial map={tex.floor} roughness={0.55} />
      </mesh>
      {/* Karpet */}
      <mesh rotation={[-Math.PI / 2, 0, Math.PI / 2]} position={[-3.45, 0.004, 3.3]} receiveShadow>
        <planeGeometry args={[2.4, 3.0]} />
        <meshStandardMaterial map={tex.rug} roughness={1} />
      </mesh>

      {/* Dinding abu (x = minX), menghadap +x */}
      <mesh rotation={[0, Math.PI / 2, 0]} position={[minX, H / 2, cz]} receiveShadow>
        <planeGeometry args={[depth, H]} />
        {greyWall}
      </mesh>
      {/* Dinding hitam (z = minZ), menghadap +z, dengan lubang pintu */}
      <mesh position={[(minX + DOOR_X[0]) / 2, H / 2, minZ]} receiveShadow>
        <planeGeometry args={[DOOR_X[0] - minX, H]} />
        {blackWall}
      </mesh>
      <mesh position={[(DOOR_X[1] + maxX) / 2, H / 2, minZ]} receiveShadow>
        <planeGeometry args={[maxX - DOOR_X[1], H]} />
        {blackWall}
      </mesh>
      <mesh position={[(DOOR_X[0] + DOOR_X[1]) / 2, (DOOR_H + H) / 2, minZ]}>
        <planeGeometry args={[DOOR_X[1] - DOOR_X[0], H - DOOR_H]} />
        {blackWall}
      </mesh>
      {/* Kusen pintu kayu */}
      {[DOOR_X[0], DOOR_X[1]].map((x) => (
        <mesh key={x} position={[x, DOOR_H / 2, minZ + 0.03]}>
          <boxGeometry args={[0.07, DOOR_H, 0.08]} />
          <meshStandardMaterial color={TRIM} />
        </mesh>
      ))}
      <mesh position={[(DOOR_X[0] + DOOR_X[1]) / 2, DOOR_H, minZ + 0.03]}>
        <boxGeometry args={[DOOR_X[1] - DOOR_X[0] + 0.07, 0.07, 0.08]} />
        <meshStandardMaterial color={TRIM} />
      </mesh>
      {/* Ruang belakang yang terlihat lewat pintu */}
      <group position={[(DOOR_X[0] + DOOR_X[1]) / 2, 0, minZ - 1.1]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[2.4, 2.2]} />
          <meshStandardMaterial map={tex.floor} roughness={0.6} />
        </mesh>
        <mesh position={[0, H / 2, -1.1]}>
          <planeGeometry args={[2.4, H]} />
          <meshStandardMaterial color="#d9d6cf" />
        </mesh>
        <mesh position={[1.2, H / 2, 0]} rotation={[0, -Math.PI / 2, 0]}>
          <planeGeometry args={[2.2, H]} />
          <meshStandardMaterial color="#cfccc5" />
        </mesh>
        <mesh position={[-1.2, H / 2, 0]} rotation={[0, Math.PI / 2, 0]}>
          <planeGeometry args={[2.2, H]} />
          <meshStandardMaterial color="#cfccc5" />
        </mesh>
        <mesh position={[0.3, 0.38, -0.75]} castShadow>
          <boxGeometry args={[0.9, 0.76, 0.5]} />
          <meshStandardMaterial color="#6b4a31" />
        </mesh>
        <mesh position={[0.3, 0.98, -0.8]}>
          <boxGeometry args={[0.45, 0.36, 0.04]} />
          <meshStandardMaterial color="#f5f5f5" emissive="#dfe9f5" emissiveIntensity={0.5} />
        </mesh>
        <pointLight position={[0, 2.5, -0.3]} intensity={2} distance={4} color="#fff4e0" />
      </group>

      {/* Plafon papan putih (menghadap ke bawah) + list kayu cokelat */}
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[cx, H, cz]}>
        <planeGeometry args={[width, depth]} />
        <meshStandardMaterial map={tex.ceiling} roughness={0.7} />
      </mesh>
      <mesh position={[minX + 0.06, H - 0.12, cz]}>
        <boxGeometry args={[0.12, 0.24, depth]} />
        <meshStandardMaterial color={TRIM} roughness={0.6} />
      </mesh>
      <mesh position={[cx, H - 0.12, minZ + 0.06]}>
        <boxGeometry args={[width, 0.24, 0.12]} />
        <meshStandardMaterial color={TRIM} roughness={0.6} />
      </mesh>
      <mesh position={[minX + 0.04, H - 0.32, cz]}>
        <boxGeometry args={[0.05, 0.05, depth]} />
        <meshStandardMaterial color={TRIM} />
      </mesh>
      <mesh position={[cx, H - 0.32, minZ + 0.04]}>
        <boxGeometry args={[width, 0.05, 0.05]} />
        <meshStandardMaterial color={TRIM} />
      </mesh>
      {/* Lampu sorot tanam + lampu bulat */}
      {spots.map(([x, z]) => (
        <mesh key={`${x}${z}`} rotation={[Math.PI / 2, 0, 0]} position={[x, H - 0.005, z]}>
          <circleGeometry args={[0.07, 20]} />
          <meshStandardMaterial color="#fffaf0" emissive="#fff3d6" emissiveIntensity={2} />
        </mesh>
      ))}
      <mesh position={[-0.6, H - 0.05, 0.2]}>
        <cylinderGeometry args={[0.32, 0.34, 0.08, 40]} />
        <meshStandardMaterial color="#eaf3ff" emissive="#cfe3ff" emissiveIntensity={1.6} />
      </mesh>

      {/* Jendela berkerai di atas deretan meja */}
      <group position={[minX + 0.02, 1.65, (DESK_ROW_Z.bot + DESK_ROW_Z.booking) / 2]} rotation={[0, Math.PI / 2, 0]}>
        <mesh>
          <planeGeometry args={[1.5, 1.25]} />
          <meshStandardMaterial color="#f4f7fb" emissive="#e6f0ff" emissiveIntensity={0.9} />
        </mesh>
        {Array.from({ length: 16 }, (_, i) => (
          <mesh key={i} position={[0, -0.58 + i * 0.077, 0.03]} rotation={[-0.5, 0, 0]}>
            <boxGeometry args={[1.46, 0.05, 0.004]} />
            <meshStandardMaterial color="#c9ccd1" roughness={0.6} />
          </mesh>
        ))}
        {[-0.78, 0.78].map((x) => (
          <mesh key={x} position={[x, 0, 0.03]}>
            <boxGeometry args={[0.05, 1.35, 0.06]} />
            <meshStandardMaterial color="#2b2b2b" />
          </mesh>
        ))}
        {[-0.65, 0.65].map((y) => (
          <mesh key={y} position={[0, y, 0.03]}>
            <boxGeometry args={[1.6, 0.05, 0.06]} />
            <meshStandardMaterial color="#2b2b2b" />
          </mesh>
        ))}
      </group>
      <pointLight position={[minX + 0.6, 1.7, (DESK_ROW_Z.bot + DESK_ROW_Z.booking) / 2]} intensity={1.5} distance={3.5} color="#eef5ff" />

      {/* Hiasan relief kayu, bingkai foto, papan INDONESIA, lemari dinding kayu */}
      <mesh position={[minX + 0.03, 1.75, 0.55]} rotation={[0, Math.PI / 2, 0]} castShadow>
        <boxGeometry args={[0.9, 0.6, 0.04]} />
        <meshStandardMaterial color="#8a5a36" roughness={0.8} />
      </mesh>
      <mesh position={[minX + 0.055, 1.75, 0.55]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[0.8, 0.5]} />
        <meshStandardMaterial color="#a8774c" roughness={0.9} />
      </mesh>
      {(
        [
          [2.35, 1.95, 0.42, 0.52, tex.sunset],
          [3.15, 2.05, 0.38, 0.5, tex.poster],
          [3.25, 1.45, 0.62, 0.24, tex.indonesia],
        ] as Array<[number, number, number, number, THREE.Texture]>
      ).map(([z, y, w, h, map]) => (
        <group key={`${z}${y}`} position={[minX + 0.03, y, z]} rotation={[0, Math.PI / 2, 0]}>
          <mesh>
            <boxGeometry args={[w + 0.05, h + 0.05, 0.03]} />
            <meshStandardMaterial color="#121212" />
          </mesh>
          <mesh position={[0, 0, 0.017]}>
            <planeGeometry args={[w, h]} />
            <meshStandardMaterial map={map} roughness={0.5} />
          </mesh>
        </group>
      ))}
      <mesh position={[minX + 0.2, 2.15, 4.05]} castShadow>
        <boxGeometry args={[0.38, 0.5, 0.8]} />
        <meshStandardMaterial color="#b9844f" roughness={0.6} />
      </mesh>

      {/* TV berlogo JVTO di dinding hitam */}
      <group position={[TV_X, 2.05, minZ + 0.04]}>
        <mesh>
          <boxGeometry args={[1.62, 0.94, 0.05]} />
          <meshStandardMaterial color="#0d0d0f" roughness={0.3} />
        </mesh>
        <mesh position={[0, 0, 0.026]}>
          <planeGeometry args={[1.54, 0.86]} />
          <meshStandardMaterial map={tex.logo} emissiveMap={tex.logo} emissive="#ffffff" emissiveIntensity={0.9} />
        </mesh>
        <pointLight position={[0, 0, 0.5]} intensity={0.8} distance={2.5} color="#9cc0ff" />
      </group>

      <RedLocker />
      <Sofa />
      <CoffeeTable />
      <BarStool />
      <StandingFan />
    </group>
  )
}
