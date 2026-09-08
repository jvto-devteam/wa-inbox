'use client'
import { cn } from '@/lib/utils'
import { PIPELINE_STEPS, listPipelineEdges, type PipelineStep, type PipelineStepId } from '@/lib/pipeline/steps'
import type { PipelineStepStatus } from '@/lib/pipeline/tracer'

/**
 * Kanvas alur pesan — DILIHAT, bukan diedit.
 *
 * --- Kenapa digambar tangan, bukan dengan library kanvas ---
 *
 * Node-nya TETAP (11, dari `PIPELINE_STEPS`) dan koordinatnya SUDAH ADA di registry sebagai
 * data. Yang dijual React Flow dan sejenisnya adalah drag-drop, penyusunan ulang otomatis, dan
 * penyuntingan graf — tiga hal yang tidak ada di sini dan tidak akan pernah ada, karena graf
 * ini adalah cerminan kode, bukan dokumen yang boleh diubah operator. Yang tersisa dari sebuah
 * library kanvas setelah itu semua dicoret hanyalah "menggambar kotak pada x/y dan garis di
 * antaranya", yaitu isi file ini.
 *
 * --- Kenapa SVG untuk garis TAPI HTML untuk kotak ---
 *
 * Dua lapis yang saling menumpuk, bukan satu:
 *   - Garis: satu <svg> dengan pointer-events dimatikan. Kurva dan panah memang pekerjaan SVG.
 *   - Kotak: <button> HTML yang diposisikan absolut di atasnya. Sebuah <rect> SVG tidak bisa
 *     difokus keyboard, tidak punya nama aksesibilitas, dan tidak menjadi tombol tanpa
 *     ditambal role/tabIndex/handler keydown sendiri. Step di sini HARUS bisa diklik untuk
 *     membuka detail, jadi ia harus benar-benar sebuah tombol — bukan bentuk yang berpura-pura.
 *
 * Keduanya memakai sistem koordinat yang sama persis (koordinat registry + PAD), sehingga garis
 * dan kotak tidak bisa saling melenceng.
 *
 * --- Lebar ---
 *
 * Kanvasnya lebih lebar daripada layar mana pun dan itu memang bentuknya: sebelas step berderet.
 * Yang menggulir adalah KONTAINERNYA sendiri (`overflow-x-auto`), bukan halaman. Halaman yang
 * ikut melebar akan menggeser sub-nav dan seluruh isi halaman lain setiap kali kanvas ini
 * dibuka.
 */

/** Ukuran satu kotak. Tetap, karena jumlah dan posisi kotaknya juga tetap. */
const NODE_W = 176
const NODE_H = 76
/** Ruang di tepi kanvas supaya lengkungan yang naik ke atas lajur tidak terpotong. */
const PAD = 56
/** Jarak maksimum yang masih dianggap "kolom sebelah" — di atas itu garisnya melompati kotak. */
const ADJACENT_GAP = 60

export const CANVAS_WIDTH = Math.max(...PIPELINE_STEPS.map((step) => step.x)) + NODE_W + PAD * 2
export const CANVAS_HEIGHT = Math.max(...PIPELINE_STEPS.map((step) => step.y)) + NODE_H + PAD * 2

/** Bahasa operator untuk status tracer. Dipakai kanvas maupun panel detail. */
export const STEP_STATUS_LABEL: Record<PipelineStepStatus, string> = {
  mulai: 'Sedang berjalan',
  selesai: 'Selesai',
  dilewati: 'Dilewati',
  berhenti: 'Berhenti di sini',
  gagal: 'Gagal',
}

const STEP_STATUS_CLASS: Record<PipelineStepStatus, string> = {
  mulai: 'border-brand bg-brand/5 text-brand',
  selesai: 'border-emerald-300 bg-emerald-50 text-emerald-700',
  dilewati: 'border-slate-300 bg-slate-50 text-slate-500',
  berhenti: 'border-amber-300 bg-amber-50 text-amber-700',
  gagal: 'border-red-300 bg-red-50 text-red-700',
}

/**
 * Warna per run yang sedang berjalan. Warnanya SELALU disertai teks (nama kontak / potongan id),
 * tidak pernah menjadi satu-satunya pembeda: dua run yang hanya dibedakan oleh warna adalah dua
 * run yang tidak terbaca oleh siapa pun yang tidak membedakan warna itu.
 */
export const RUN_COLOR_CLASSES = [
  'border-brand/40 bg-brand/10 text-brand',
  'border-violet-300 bg-violet-50 text-violet-700',
  'border-teal-300 bg-teal-50 text-teal-700',
  'border-orange-300 bg-orange-50 text-orange-700',
] as const

/** Satu run yang SEDANG berada di sebuah step. */
export type CanvasLiveMarker = {
  runId: string
  /** Nama kontak bila diketahui, kalau tidak potongan id percakapan. Tidak pernah kosong. */
  label: string
  colorIndex: number
  status: PipelineStepStatus
}

export type PipelineCanvasProps = {
  /** Status per step untuk run yang sedang DIPILIH (riwayat atau live) — jalurnya diputar ulang. */
  replayStatuses: Partial<Record<PipelineStepId, PipelineStepStatus>>
  /** Run yang sedang berjalan, dikelompokkan per step tempat mereka berada sekarang. */
  liveMarkers: Partial<Record<PipelineStepId, CanvasLiveMarker[]>>
  selectedStepId: PipelineStepId | null
  onSelectStep: (id: PipelineStepId) => void
}

type Box = { left: number; top: number; right: number; bottom: number; cx: number; cy: number }

function box(step: PipelineStep): Box {
  const left = step.x + PAD
  const top = step.y + PAD
  return { left, top, right: left + NODE_W, bottom: top + NODE_H, cx: left + NODE_W / 2, cy: top + NODE_H / 2 }
}

/**
 * Jalur satu sisi graf. Empat bentuk, dipilih dari geometri — bukan dari daftar khusus per
 * pasangan, supaya menambah step di registry tidak perlu menyentuh file ini.
 */
export function edgePath(from: PipelineStep, to: PipelineStep): string {
  const a = box(from)
  const b = box(to)

  if (from.y === to.y) {
    // Kolom sebelah: garis lurus.
    if (b.left - a.right <= ADJACENT_GAP) return `M ${a.right} ${a.cy} L ${b.left} ${b.cy}`
    // Lompat beberapa kolom: melengkung DI ATAS lajur, kalau tidak garisnya menembus kotak di
    // antaranya dan terbaca seolah singgah di sana.
    const lift = a.top - 34
    return `M ${a.cx} ${a.top} C ${a.cx} ${lift}, ${b.cx} ${lift}, ${b.cx} ${b.top}`
  }

  // Persis di bawah/atasnya: tegak lurus.
  if (Math.abs(a.cx - b.cx) < 4) {
    return from.y < to.y ? `M ${a.cx} ${a.bottom} L ${b.cx} ${b.top}` : `M ${a.cx} ${a.top} L ${b.cx} ${b.bottom}`
  }

  // Turun ke lajur handoff, masuk dari sisi kiri kotak tujuan.
  if (from.y < to.y) return `M ${a.cx} ${a.bottom} C ${a.cx} ${b.cy}, ${b.left - 70} ${b.cy}, ${b.left} ${b.cy}`

  // Naik kembali dari lajur handoff ke lajur utama.
  return `M ${a.right} ${a.cy} C ${a.right + 70} ${a.cy}, ${b.cx} ${b.bottom + 60}, ${b.cx} ${b.bottom}`
}

/**
 * Sisi "utama" adalah satu langkah maju di lajur yang sama. Sisanya cabang: eskalasi, lompatan
 * karena booking ditemukan, clarify, dan jalan pulang dari handoff.
 *
 * Dibedakan karena menggambar semuanya dengan bobot yang sama membuat kanvas ini berbohong:
 * ia akan terlihat seperti sebelas jalan yang sama-sama sering ditempuh, padahal satu di
 * antaranya adalah jalur harian dan sisanya perkecualian.
 */
export function isMainEdge(from: PipelineStep, to: PipelineStep): boolean {
  return from.y === to.y && box(to).left - box(from).right <= ADJACENT_GAP
}

export function PipelineCanvas({ replayStatuses, liveMarkers, selectedStepId, onSelectStep }: PipelineCanvasProps) {
  const edges = listPipelineEdges()

  return (
    <div className="space-y-2">
      {/*
        Kontainer inilah yang menggulir. `overflow-x-auto` di sini + lebar tetap pada anaknya =
        halaman tidak pernah ikut melebar, berapa pun panjang alurnya.
      */}
      <div className="overflow-x-auto rounded-lg border border-border bg-slate-50/60" data-pipeline-scroll>
        <div className="relative" style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }} data-pipeline-canvas>
          <svg
            className="pointer-events-none absolute inset-0"
            width={CANVAS_WIDTH}
            height={CANVAS_HEIGHT}
            viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`}
            // Dekorasi: seluruh isinya sudah dinyatakan sebagai teks pada tombol-tombol di
            // atasnya, jadi pembaca layar tidak perlu menyusuri path SVG-nya.
            aria-hidden="true"
            focusable="false"
          >
            <defs>
              <marker id="pipeline-arrow-main" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                <path d="M 0 0 L 8 4 L 0 8 z" className="fill-slate-400" />
              </marker>
              <marker id="pipeline-arrow-branch" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                <path d="M 0 0 L 8 4 L 0 8 z" className="fill-amber-400" />
              </marker>
            </defs>
            {edges.map((edge) => {
              const from = PIPELINE_STEPS.find((step) => step.id === edge.from)
              const to = PIPELINE_STEPS.find((step) => step.id === edge.to)
              if (!from || !to) return null
              const main = isMainEdge(from, to)
              return (
                <path
                  key={`${edge.from}->${edge.to}`}
                  d={edgePath(from, to)}
                  fill="none"
                  strokeWidth={main ? 2 : 1.5}
                  strokeDasharray={main ? undefined : '5 4'}
                  className={main ? 'stroke-slate-400' : 'stroke-amber-400'}
                  markerEnd={`url(#pipeline-arrow-${main ? 'main' : 'branch'})`}
                  data-edge={`${edge.from}->${edge.to}`}
                  data-edge-kind={main ? 'utama' : 'cabang'}
                >
                  <title>
                    {edge.condition ? `${edge.condition}` : `${from.label} → ${to.label}`}
                  </title>
                </path>
              )
            })}
          </svg>

          {PIPELINE_STEPS.map((step, index) => {
            const geometry = box(step)
            const status = replayStatuses[step.id]
            const markers = liveMarkers[step.id] ?? []
            const selected = selectedStepId === step.id
            return (
              <button
                key={step.id}
                type="button"
                onClick={() => onSelectStep(step.id)}
                aria-pressed={selected}
                title={step.summary}
                data-step-id={step.id}
                data-step-status={status ?? ''}
                data-live-count={markers.length}
                style={{ left: geometry.left, top: geometry.top, width: NODE_W, minHeight: NODE_H }}
                className={cn(
                  // `shadow-sm` dihapus di Tahap 1B: skala shadow-* Tailwind dimatikan di
                  // globals.css Tahap 1A, jadi kelas itu sudah tidak menghasilkan apa pun —
                  // ia hanya berbohong tentang adanya kedalaman. Kotaknya dipisahkan oleh
                  // border-nya sendiri, seperti seluruh permukaan lain di aplikasi ini.
                  'absolute flex flex-col items-start gap-1 rounded-lg border bg-white p-2 text-left transition-colors',
                  'focus-ring',
                  status ? STEP_STATUS_CLASS[status] : 'border-border text-foreground hover:bg-muted',
                  // Node yang sedang ditempati run live diberi cincin, BUKAN warna latar: warna
                  // latar sudah dipakai status jalur terpilih, dan dua arti pada satu properti
                  // yang sama membuat keduanya tidak terbaca.
                  markers.length > 0 && 'ring-2 ring-brand/40',
                  selected && 'ring-2 ring-navy'
                )}
              >
                <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {index + 1}
                </span>
                <span className="text-xs font-semibold leading-tight">{step.label}</span>
                {status && <span className="text-[10px] font-medium">{STEP_STATUS_LABEL[status]}</span>}
                {markers.length > 0 && (
                  <span className="flex flex-wrap gap-1">
                    {markers.map((marker) => (
                      <span
                        key={marker.runId}
                        data-live-run={marker.runId}
                        className={cn(
                          'rounded border px-1 py-px text-[10px] font-medium',
                          RUN_COLOR_CLASSES[marker.colorIndex % RUN_COLOR_CLASSES.length]
                        )}
                      >
                        {marker.label} · {STEP_STATUS_LABEL[marker.status]}
                      </span>
                    ))}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="inline-block h-0.5 w-6 bg-slate-400" /> jalur utama
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-0.5 w-6 border-t-2 border-dashed border-amber-400" /> cabang (eskalasi,
          booking ditemukan, clarify, jalan pulang dari handoff)
        </span>
        <span>Klik satu step untuk melihat sub-langkah dan letaknya di kode.</span>
      </p>
    </div>
  )
}

/**
 * Sub-langkah yang praktis TIDAK PERNAH menyala pada run bot, beserta alasannya.
 *
 * Dicatat di sini dan bukan disembunyikan: ia benar-benar ada di kode (registry lama punya
 * node-nya, dan kanvas ini wajib memuat semua node registry tepat sekali), tapi menggambarnya
 * setara dengan jalur harian akan membuat operator mengira balasan bot kadang lewat template
 * resmi. Tidak pernah — template Official dipakai campaign/utility, bukan balasan percakapan.
 */
export const RARE_SUB_STEPS: Record<string, string> = {
  'official-template-send':
    'Jarang: jalur Official hanya untuk kapabilitas yang memang official-only (template resmi, campaign). Balasan bot harian tidak pernah lewat sini.',
}
