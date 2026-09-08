import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import { PipelineStepDetail } from './PipelineStepDetail'
import { getPipelineStep } from '@/lib/pipeline/steps'

afterEach(cleanup)

const kirimBalasan = getPipelineStep('kirim-balasan')!
const cekEskalasi = getPipelineStep('cek-eskalasi')!

describe('PipelineStepDetail', () => {
  it('mengajak memilih step alih-alih menampilkan panel kosong', () => {
    render(<PipelineStepDetail step={null} records={[]} runLabel={null} runUnrecorded={false} />)

    expect(screen.getByText(/Klik salah satu kotak di kanvas/)).toBeInTheDocument()
  })

  it('menandai cabang yang praktis tidak pernah menyala, alih-alih menggambarnya setara jalur harian', () => {
    render(<PipelineStepDetail step={kirimBalasan} records={[]} runLabel={null} runUnrecorded={false} />)

    const official = screen.getByText('Pengiriman template Official').closest('li') as HTMLElement
    expect(within(official).getByText('jarang dipakai')).toBeInTheDocument()
    expect(official.textContent).toContain('Balasan bot harian tidak pernah lewat sini')

    // Jalur harian tidak ikut ditandai — kalau semuanya ditandai, tandanya tidak berarti apa-apa.
    const unofficial = screen.getByText('Pengiriman via Unofficial').closest('li') as HTMLElement
    expect(within(unofficial).queryByText('jarang dipakai')).toBeNull()
  })

  it('menampilkan catatan tracer beserta detailnya untuk run yang dipilih', () => {
    render(
      <PipelineStepDetail
        step={cekEskalasi}
        records={[
          { stepId: 'cek-eskalasi', status: 'mulai', at: '2026-09-08T04:00:00.000Z' },
          { stepId: 'cek-eskalasi', status: 'selesai', at: '2026-09-08T04:00:00.400Z', detail: { alasan: 'kata kunci' } },
        ]}
        runLabel="Bruno"
        runUnrecorded={false}
      />
    )

    expect(screen.getByText('Sedang berjalan')).toBeInTheDocument()
    expect(screen.getByText('Selesai')).toBeInTheDocument()
    // Detail step muncul apa adanya (JSON), bukan diringkas jadi kalimat baru.
    expect(screen.getByText(/"alasan": "kata kunci"/)).toBeInTheDocument()
  })

  it('membedakan "tidak dilewati" dari "tidak terekam"', () => {
    const { rerender } = render(
      <PipelineStepDetail step={cekEskalasi} records={[]} runLabel="Bruno" runUnrecorded={false} />
    )
    expect(screen.getByText('Run Bruno tidak melewati step ini.')).toBeInTheDocument()

    rerender(<PipelineStepDetail step={cekEskalasi} records={[]} runLabel="Bruno" runUnrecorded />)
    expect(screen.getByText(/run berjalan sebelum instrumentasi ada/)).toBeInTheDocument()
    expect(screen.queryByText('Run Bruno tidak melewati step ini.')).toBeNull()
  })

  it('tidak melempar untuk detail yang tidak bisa diserialisasi', () => {
    const looping: Record<string, unknown> = {}
    looping.self = looping

    render(
      <PipelineStepDetail
        step={cekEskalasi}
        records={[{ stepId: 'cek-eskalasi', status: 'gagal', at: '', detail: looping }]}
        runLabel="Bruno"
        runUnrecorded={false}
      />
    )

    expect(screen.getByText('(detail tidak bisa ditampilkan)')).toBeInTheDocument()
  })
})
