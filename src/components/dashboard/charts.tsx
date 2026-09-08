'use client'
import { cn } from '@/lib/utils'

/**
 * Tiga bentuk grafik, digambar tangan dengan SVG. TIDAK ADA dependensi grafik.
 *
 * Bukan penghematan bundle demi penghematan: yang dibutuhkan halaman ini adalah tiga bentuk
 * sederhana (bar horizontal, bar bertumpuk, kolom harian), dan sebuah pustaka grafik membawa
 * sistem warna, tipografi, dan tooltip-nya sendiri yang seluruhnya harus dilawan supaya tidak
 * bertabrakan dengan sistem desain di globals.css. Tiga <rect> lebih sedikit kode daripada
 * konfigurasi untuk mematikan semua itu.
 *
 * KEPUTUSAN BENTUK: marka digambar SVG, TEKS ditulis HTML di sekelilingnya.
 * `preserveAspectRatio="none"` membuat sebuah rect meregang mengikuti lebar panel apa pun tanpa
 * perlu mengukur kontainer — sebuah rect yang diregangkan tetaplah rect. Tapi teks yang ikut
 * diregangkan akan mengecil dan membesar mengikuti lebar kolom grid, dan ukuran huruf yang
 * berubah-ubah menurut breakpoint adalah persis yang tidak boleh terjadi pada skala tipografi
 * Tahap 1A. Jadi label sumbu, nilai, dan legenda semuanya HTML dengan token tema yang sama
 * seperti sisa aplikasi, dan SVG hanya memegang batangnya.
 */

export type ChartTone = 'ink' | 'muted' | 'line' | 'accent' | 'success' | 'warning' | 'danger'

/** Satu-satunya tempat tone dipetakan ke warna. Semuanya token tema, tidak ada heksadesimal. */
const FILL: Record<ChartTone, string> = {
  ink: 'fill-ink',
  muted: 'fill-ink-muted',
  line: 'fill-line-strong',
  accent: 'fill-accent',
  success: 'fill-success',
  warning: 'fill-warning',
  danger: 'fill-danger',
}

const SWATCH: Record<ChartTone, string> = {
  ink: 'bg-ink',
  muted: 'bg-ink-muted',
  line: 'bg-line-strong',
  accent: 'bg-accent',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
}

/**
 * Batang yang nilainya bukan nol tapi terlalu kecil untuk digambar tetap harus terlihat: "satu"
 * dan "tidak ada" adalah dua jawaban berbeda, dan garis setebal sepersepuluh piksel membuat
 * keduanya terlihat sama.
 */
const MIN_VISIBLE = 1.5

/** Bar horizontal di atas trek. Dipakai funnel dan daftar topik. */
export function HBar({ value, max, tone = 'ink' }: { value: number; max: number; tone?: ChartTone }) {
  const raw = max > 0 ? (value / max) * 100 : 0
  const width = value > 0 ? Math.max(raw, MIN_VISIBLE) : 0

  return (
    <svg
      viewBox="0 0 100 6"
      preserveAspectRatio="none"
      aria-hidden="true"
      className="block h-1.5 w-full overflow-hidden rounded-xs bg-surface-sunken"
    >
      {width > 0 && <rect x="0" y="0" width={width} height="6" className={FILL[tone]} />}
    </svg>
  )
}

/**
 * Satu batang, beberapa bagian — sebaran keputusan bot.
 *
 * Bentuk ini dipilih karena pertanyaannya adalah proporsi ("seberapa besar bagian yang menyerah"),
 * dan proporsi adalah satu-satunya hal yang tidak bisa dibaca dari empat angka yang berjajar.
 */
export function SegmentBar({
  segments,
  className,
}: {
  segments: { key: string; value: number; tone: ChartTone }[]
  className?: string
}) {
  const total = segments.reduce((sum, s) => sum + s.value, 0)
  if (total <= 0) return null

  // Offset kumulatif dihitung lebih dulu, bukan di dalam .map: sebuah variabel yang berubah di
  // dalam callback render adalah persis pola yang dilarang React Compiler, dan ia benar —
  // callback itu tidak dijamin berjalan sekali per render.
  const rects: { key: string; x: number; width: number; tone: ChartTone }[] = []
  let offset = 0
  for (const s of segments) {
    if (s.value <= 0) continue
    const width = Math.max((s.value / total) * 100, MIN_VISIBLE)
    rects.push({ key: s.key, x: offset, width, tone: s.tone })
    offset += width
  }

  return (
    <svg
      viewBox="0 0 100 6"
      preserveAspectRatio="none"
      aria-hidden="true"
      className={cn('block h-1.5 w-full overflow-hidden rounded-xs bg-surface-sunken', className)}
    >
      {rects.map((r) => (
        <rect key={r.key} x={r.x} y="0" width={r.width} height="6" className={FILL[r.tone]} />
      ))}
    </svg>
  )
}

/** Kotak warna legenda — HTML, supaya tulisannya tetap teks biasa yang bisa dipilih dan dibaca. */
export function LegendSwatch({ tone, label }: { tone: ChartTone; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-ink-muted">
      <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-xs', SWATCH[tone])} />
      {label}
    </span>
  )
}

export type DayVolume = { day: string; inbound: number; outbound: number }

/**
 * Kolom bertumpuk per hari: masuk di bawah, keluar di atas.
 *
 * Bertumpuk dan bukan berdampingan karena pertanyaan pertamanya adalah "seberapa sibuk hari itu"
 * (tinggi total) dan yang kedua "berapa banyak yang kami balas" (pembagiannya) — dua batang
 * terpisah menjawab yang kedua dan membuat yang pertama harus dijumlah dengan mata.
 *
 * Menyorot satu kolom mengubah pembacaan angka di atas grafik. Itulah satu-satunya interaksi di
 * sini, dan ia ada karena tanpanya grafik tiga puluh hari hanya bisa menjawab "bentuknya naik
 * atau turun" — bukan "hari Sabtu itu berapa".
 */
export function DayColumns({
  days,
  activeIndex,
  onHover,
  label,
}: {
  days: DayVolume[]
  activeIndex: number | null
  onHover: (index: number | null) => void
  label: string
}) {
  const max = days.reduce((m, d) => Math.max(m, d.inbound + d.outbound), 0)
  const slot = 10
  const gap = 2

  return (
    <svg
      viewBox={`0 0 ${Math.max(days.length, 1) * slot} 100`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
      className="block h-24 w-full border-b border-line"
      onMouseLeave={() => onHover(null)}
    >
      {days.map((d, i) => {
        const scale = max > 0 ? 100 / max : 0
        const inH = d.inbound > 0 ? Math.max(d.inbound * scale, MIN_VISIBLE) : 0
        const outH = d.outbound > 0 ? Math.max(d.outbound * scale, MIN_VISIBLE) : 0
        const x = i * slot + gap / 2
        const width = slot - gap
        const active = i === activeIndex

        return (
          <g key={d.day}>
            {active && <rect x={i * slot} y="0" width={slot} height="100" className="fill-surface-sunken" />}
            {outH > 0 && (
              <rect x={x} y={100 - inH - outH} width={width} height={outH} className={FILL['line']} />
            )}
            {inH > 0 && <rect x={x} y={100 - inH} width={width} height={inH} className={FILL['ink']} />}
            {/* Sasaran sorot setinggi penuh: hari sepi tetap bisa disorot walau batangnya
                setinggi satu piksel. */}
            <rect
              x={i * slot}
              y="0"
              width={slot}
              height="100"
              fill="transparent"
              onMouseEnter={() => onHover(i)}
            />
          </g>
        )
      })}
    </svg>
  )
}
