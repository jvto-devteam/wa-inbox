/**
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest'
import { parsePipelineSteps, summarisePipelineSteps } from './pipeline-runs'

describe('parsePipelineSteps', () => {
  it('membaca jejak yang ditulis tracer apa adanya', () => {
    const steps = parsePipelineSteps([
      { stepId: 'terima-pesan', status: 'selesai', at: '2026-09-08T04:00:00.000Z' },
      { stepId: 'cek-eskalasi', status: 'mulai', at: '2026-09-08T04:00:01.000Z', detail: { alasan: 'x' } },
    ])

    expect(steps).toEqual([
      { stepId: 'terima-pesan', status: 'selesai', at: '2026-09-08T04:00:00.000Z' },
      { stepId: 'cek-eskalasi', status: 'mulai', at: '2026-09-08T04:00:01.000Z', detail: { alasan: 'x' } },
    ])
  })

  it('membedakan "tidak terekam" (null) dari bentuk lain apa pun, tanpa melempar', () => {
    // Semua bentuk ini nyata bisa ada di kolom Json bebas. Tidak satu pun boleh melempar.
    for (const value of [null, undefined, 'steps', 42, true, { stepId: 'terima-pesan' }]) {
      expect(parsePipelineSteps(value)).toBeNull()
    }
  })

  it('membuang entri yang tidak bisa dibaca alih-alih menebaknya', () => {
    const steps = parsePipelineSteps([
      { stepId: 'langkah-yang-sudah-dihapus', status: 'selesai', at: 'x' },
      { stepId: 'terima-pesan', status: 'status-karangan', at: 'x' },
      { stepId: 42, status: 'selesai', at: 'x' },
      null,
      ['terima-pesan'],
      { stepId: 'kirim-balasan', status: 'selesai' },
    ])

    // Hanya yang terakhir yang sah; `at` yang hilang menjadi string kosong, bukan alasan
    // membuang seluruh entri.
    expect(steps).toEqual([{ stepId: 'kirim-balasan', status: 'selesai', at: '' }])
  })
})

describe('summarisePipelineSteps', () => {
  it('menyebut di mana run berhenti', () => {
    expect(
      summarisePipelineSteps([
        { stepId: 'terima-pesan', status: 'selesai', at: 'a' },
        { stepId: 'gerbang-bot', status: 'berhenti', at: 'b' },
      ])
    ).toEqual({ recorded: true, stepCount: 2, lastStepId: 'gerbang-bot', lastStatus: 'berhenti' })
  })

  it('menandai run tanpa jejak sebagai tidak terekam, bukan sebagai run kosong yang gagal', () => {
    for (const value of [null, [], [{ stepId: 'tak-dikenal', status: 'selesai', at: 'a' }]]) {
      expect(summarisePipelineSteps(value)).toEqual({
        recorded: false,
        stepCount: 0,
        lastStepId: null,
        lastStatus: null,
      })
    }
  })
})
