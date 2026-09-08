import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { PipelineCanvas, CANVAS_WIDTH, edgePath, isMainEdge } from './PipelineCanvas'
import { PIPELINE_STEPS, listPipelineEdges, getPipelineStep } from '@/lib/pipeline/steps'

afterEach(cleanup)

function renderCanvas(overrides: Partial<Parameters<typeof PipelineCanvas>[0]> = {}) {
  return render(
    <PipelineCanvas
      replayStatuses={{}}
      liveMarkers={{}}
      selectedStepId={null}
      onSelectStep={() => {}}
      {...overrides}
    />
  )
}

describe('PipelineCanvas', () => {
  it('menggambar setiap step registry tepat sekali, pada koordinat registry', () => {
    const { container } = renderCanvas()

    const nodes = [...container.querySelectorAll('[data-step-id]')]
    expect(nodes.map((n) => n.getAttribute('data-step-id'))).toEqual(PIPELINE_STEPS.map((step) => step.id))

    // Layout adalah DATA, bukan hitungan: kotak harus benar-benar berdiri di x/y registry
    // (digeser padding kanvas), bukan di posisi yang dikarang lapisan UI.
    const first = nodes[0] as HTMLElement
    expect(first.style.left).toBe(`${PIPELINE_STEPS[0].x + 56}px`)
    expect(first.style.top).toBe(`${PIPELINE_STEPS[0].y + 56}px`)
  })

  it('menggambar setiap sisi graf, termasuk percabangan', () => {
    const { container } = renderCanvas()

    for (const edge of listPipelineEdges()) {
      const path = container.querySelector(`[data-edge="${edge.from}->${edge.to}"]`)
      expect(path, `sisi ${edge.from}->${edge.to} tidak digambar`).not.toBeNull()
    }
    // Percabangan nyata: eskalasi keluar dari lajur utama, dan handoff kembali ke jalur kirim.
    expect(container.querySelector('[data-edge="cek-eskalasi->serahkan-agen"]')).toHaveAttribute(
      'data-edge-kind',
      'cabang'
    )
    expect(container.querySelector('[data-edge="serahkan-agen->kirim-balasan"]')).toHaveAttribute(
      'data-edge-kind',
      'cabang'
    )
  })

  it('membedakan jalur utama dari cabang, supaya cabang jarang tidak terbaca sebagai jalur harian', () => {
    const step = (id: string) => getPipelineStep(id)!

    expect(isMainEdge(step('terima-pesan'), step('simpan-percakapan'))).toBe(true)
    // Lompatan karena booking ditemukan melewati dua kolom — bukan langkah berikutnya.
    expect(isMainEdge(step('cek-booking'), step('verifikasi-balasan'))).toBe(false)
    // Pindah lajur ke handoff tidak pernah "utama".
    expect(isMainEdge(step('cek-eskalasi'), step('serahkan-agen'))).toBe(false)
  })

  it('melengkungkan garis yang melompati kolom supaya tidak menembus kotak di antaranya', () => {
    const from = getPipelineStep('cek-booking')!
    const to = getPipelineStep('verifikasi-balasan')!

    // Bukan garis lurus (L), melainkan kurva (C) yang naik di atas lajur.
    expect(edgePath(from, to)).toMatch(/^M .* C /)
    expect(edgePath(getPipelineStep('terima-pesan')!, getPipelineStep('simpan-percakapan')!)).toMatch(/^M .* L /)
  })

  // Gerbang 8: kanvas ini lebih lebar daripada layar mana pun, dan yang boleh menggulir adalah
  // kontainernya sendiri. Halaman yang ikut melebar akan menggeser sub-nav dan setiap halaman
  // lain yang memakai layout yang sama.
  it('menaruh lebar tetapnya di dalam kontainer overflow-x-auto, bukan di halaman', () => {
    const { container } = renderCanvas()

    const canvas = container.querySelector('[data-pipeline-canvas]') as HTMLElement
    const scroller = container.querySelector('[data-pipeline-scroll]') as HTMLElement

    expect(canvas.style.width).toBe(`${CANVAS_WIDTH}px`)
    expect(CANVAS_WIDTH).toBeGreaterThan(1280)
    expect(scroller.className).toContain('overflow-x-auto')
    // Yang lebar HARUS berada di dalam yang menggulir; kalau terbalik, halamanlah yang melebar.
    expect(scroller.contains(canvas)).toBe(true)
    // Dan SETIAP elemen berlebar piksel di komponen ini berada di dalam kontainer yang
    // menggulir — satu saja yang bocor ke luar sudah cukup untuk melebarkan halaman.
    const widened = [...container.querySelectorAll<HTMLElement>('[style*="width"]')].filter((element) =>
      /\d+px/.test(element.style.width)
    )
    expect(widened.length).toBeGreaterThan(0)
    expect(widened.every((element) => scroller.contains(element))).toBe(true)
  })

  it('menjadikan setiap step tombol sungguhan, bukan bentuk SVG yang berpura-pura bisa diklik', () => {
    const onSelectStep = vi.fn()
    const { container } = renderCanvas({ onSelectStep })

    // Tombol HTML: bisa difokus keyboard dan punya nama aksesibilitas. <rect> SVG tidak.
    expect(screen.getAllByRole('button')).toHaveLength(PIPELINE_STEPS.length)

    fireEvent.click(container.querySelector('[data-step-id="susun-balasan"]') as HTMLElement)
    expect(onSelectStep).toHaveBeenCalledWith('susun-balasan')
  })

  it('memberi status jalur terpilih dan penanda run live tempat yang berbeda', () => {
    const { container } = renderCanvas({
      replayStatuses: { 'cek-booking': 'dilewati' },
      liveMarkers: {
        'susun-balasan': [{ runId: 'run_1', label: 'Bruno', colorIndex: 0, status: 'mulai' }],
      },
      selectedStepId: 'cek-booking',
    })

    const replayed = container.querySelector('[data-step-id="cek-booking"]') as HTMLElement
    expect(replayed).toHaveAttribute('data-step-status', 'dilewati')
    expect(replayed).toHaveAttribute('aria-pressed', 'true')
    expect(replayed.textContent).toContain('Dilewati')

    const live = container.querySelector('[data-step-id="susun-balasan"]') as HTMLElement
    expect(live).toHaveAttribute('data-live-count', '1')
    expect(live.querySelector('[data-live-run="run_1"]')?.textContent).toContain('Bruno')
  })
})
