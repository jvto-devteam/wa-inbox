import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { PipelineFunnelBar } from './PipelineFunnelBar'
import { FUNNEL_STAGES, FUNNEL_STAGE_LABELS } from '@/lib/pipeline/funnel'

afterEach(cleanup)

describe('PipelineFunnelBar', () => {
  it('mengambil urutan dan nama tahap dari funnel.ts, bukan dari response', () => {
    // Response sengaja diacak urutannya dan satu tahap dihilangkan: yang menentukan tangga
    // adalah modulnya, bukan apa yang kebetulan dikirim server.
    render(
      <PipelineFunnelBar
        stages={[
          { id: 'DITERUSKAN', count: 4 },
          { id: 'MASUK', count: 3 },
          { id: 'ADA_TUJUAN', count: 1 },
        ]}
        total={8}
        windowSize={500}
      />
    )

    const rendered = screen.getAllByRole('listitem').map((item) => item.textContent ?? '')
    expect(rendered).toHaveLength(FUNNEL_STAGES.length)
    FUNNEL_STAGES.forEach((stage, index) => {
      expect(rendered[index]).toContain(FUNNEL_STAGE_LABELS[stage.id])
    })

    // Tahap yang tidak disebut response adalah nol, bukan hilang dari tangga.
    expect(rendered[FUNNEL_STAGES.findIndex((s) => s.id === 'ADA_KOTA_AKHIR')]).toContain('0')
    expect(rendered[FUNNEL_STAGES.findIndex((s) => s.id === 'DITERUSKAN')]).toContain('4')
  })

  it('menyebut jendelanya, supaya angkanya tidak dibaca sebagai total seluruh bisnis', () => {
    render(<PipelineFunnelBar stages={[{ id: 'MASUK', count: 2 }]} total={2} windowSize={500} />)

    expect(screen.getByText(/2 percakapan terakhir \(jendela 500/)).toBeInTheDocument()
  })

  it('mengatakan kosong sebagai kosong, bukan menggambar tangga palsu', () => {
    render(<PipelineFunnelBar stages={[]} total={0} windowSize={500} />)

    expect(screen.getByText(/Belum ada percakapan yang bisa dipetakan/)).toBeInTheDocument()
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  })
})
