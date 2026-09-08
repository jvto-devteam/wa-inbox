import { describe, it, expect, vi, beforeEach } from 'vitest'
import { broadcast } from '@/lib/realtime'
import {
  createPipelineTracer,
  createNoopPipelineTracer,
  openPipelineRun,
  traceStep,
  traceClose,
  traceSnapshot,
  traceRunId,
  type PipelineTracer,
} from './tracer'

vi.mock('@/lib/realtime', () => ({ broadcast: vi.fn() }))

beforeEach(() => {
  vi.mocked(broadcast).mockReset()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

function pipelineEvents() {
  return vi.mocked(broadcast).mock.calls.map(([event]) => event)
}

describe('createPipelineTracer', () => {
  it('menyiarkan setiap batas step seketika, tidak menunggu run selesai', () => {
    const tracer = createPipelineTracer('conv_1')

    tracer.mark('terima-pesan', 'selesai')

    expect(pipelineEvents()).toEqual([
      expect.objectContaining({
        type: 'pipeline.step',
        runId: tracer.runId,
        conversationId: 'conv_1',
        stepId: 'terima-pesan',
        status: 'selesai',
      }),
    ])
  })

  it('menutup step yang masih terbuka begitu step berikutnya ditandai', () => {
    const tracer = createPipelineTracer('conv_1')

    tracer.mark('cek-eskalasi', 'mulai')
    tracer.mark('cek-booking', 'mulai')

    expect(tracer.snapshot().map((s) => [s.stepId, s.status])).toEqual([
      ['cek-eskalasi', 'mulai'],
      ['cek-eskalasi', 'selesai'],
      ['cek-booking', 'mulai'],
    ])
  })

  it('closeOpen menutup step terbuka dengan status akhir dan tidak melakukan apa-apa dua kali', () => {
    const tracer = createPipelineTracer('conv_1')

    tracer.mark('pahami-kebutuhan', 'mulai')
    tracer.closeOpen('berhenti', { alasan: 'agent mengambil alih' })
    tracer.closeOpen('berhenti', { alasan: 'tidak boleh muncul dua kali' })

    expect(tracer.snapshot().map((s) => [s.stepId, s.status])).toEqual([
      ['pahami-kebutuhan', 'mulai'],
      ['pahami-kebutuhan', 'berhenti'],
    ])
  })

  it('closeOpen adalah no-op bila tidak ada step yang terbuka', () => {
    const tracer = createPipelineTracer('conv_1')

    tracer.mark('gerbang-bot', 'berhenti')
    tracer.closeOpen('gagal')

    expect(tracer.snapshot()).toHaveLength(1)
  })

  it('membatasi jumlah step per run supaya satu run aneh tidak menulis Json raksasa', () => {
    const tracer = createPipelineTracer('conv_1')

    for (let i = 0; i < 500; i += 1) tracer.mark('kirim-balasan', 'selesai')

    expect(tracer.snapshot().length).toBeLessThanOrEqual(64)
  })

  it('memotong detail yang kelewat besar alih-alih menyimpannya utuh', () => {
    const tracer = createPipelineTracer('conv_1')

    tracer.mark('susun-balasan', 'selesai', { blob: 'x'.repeat(5000) })

    const [step] = tracer.snapshot()
    expect(JSON.stringify(step.detail).length).toBeLessThan(512)
    expect(step.detail).toMatchObject({ _terpotong: expect.stringContaining('melewati batas') })
  })

  it('snapshot mengembalikan salinan, bukan array internal yang bisa diubah pemanggil', () => {
    const tracer = createPipelineTracer('conv_1')
    tracer.mark('terima-pesan', 'selesai')

    const first = tracer.snapshot()
    first[0].status = 'gagal'

    expect(tracer.snapshot()[0].status).toBe('selesai')
  })

  it('memakai runId yang diberikan pemanggil bila ada, supaya satu run bisa dilanjutkan', () => {
    const tracer = createPipelineTracer('conv_1', 'run_dari_luar')

    expect(tracer.runId).toBe('run_dari_luar')
    tracer.mark('terima-pesan', 'selesai')
    expect(pipelineEvents()[0]).toMatchObject({ runId: 'run_dari_luar' })
  })
})

// Aturan mutlak proyek: token/API key tidak boleh muncul di UI, response API, maupun log.
// `detail` melewati ketiganya sekaligus (kolom Json, event SSE ke setiap tab, konsol), jadi ia
// dibersihkan SEBELUM disimpan maupun disiarkan -- bukan saat render.
describe('pembersihan rahasia pada detail step', () => {
  const detail = {
    accessToken: 'EAAGm0PX4ZCpsBO1234567890abcdefghijklmnop',
    catatan: 'gagal memanggil https://graph.facebook.com/v21.0/me?access_token=EAAGm0PX4ZCpsBO1234567890abcdef',
  }

  it('tidak menyimpan token mentah di step yang terkumpul', () => {
    const tracer = createPipelineTracer('conv_1')

    tracer.mark('kirim-balasan', 'gagal', detail)

    const serialized = JSON.stringify(tracer.snapshot())
    expect(serialized).not.toContain('EAAGm0PX4ZCpsBO1234567890abcdefghijklmnop')
    expect(serialized).toContain('[REDACTED]')
  })

  it('tidak menyiarkan token mentah ke klien SSE', () => {
    const tracer = createPipelineTracer('conv_1')

    tracer.mark('kirim-balasan', 'gagal', detail)

    const serialized = JSON.stringify(pipelineEvents())
    expect(serialized).not.toContain('EAAGm0PX4ZCpsBO1234567890abcdefghijklmnop')
    expect(serialized).not.toContain('EAAGm0PX4ZCpsBO1234567890abcdef')
    expect(serialized).toContain('[REDACTED]')
  })
})

describe('ketahanan tracer', () => {
  it('broadcast yang melempar tidak menghentikan run dan tidak menghilangkan step', () => {
    vi.mocked(broadcast).mockImplementation(() => {
      throw new Error('controller SSE sudah ditutup')
    })
    const tracer = createPipelineTracer('conv_1')

    expect(() => tracer.mark('terima-pesan', 'selesai')).not.toThrow()
    expect(() => tracer.mark('simpan-percakapan', 'selesai')).not.toThrow()
    expect(tracer.snapshot()).toHaveLength(2)
  })

  it('detail yang tidak bisa diserialisasi (siklus) tidak melempar', () => {
    const tracer = createPipelineTracer('conv_1')
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic

    expect(() => tracer.mark('susun-balasan', 'selesai', cyclic)).not.toThrow()
    expect(tracer.snapshot()).toHaveLength(1)
  })

  it('tracer kosong tidak menyiarkan apa pun dan tidak punya runId', () => {
    const tracer = createNoopPipelineTracer()

    tracer.mark('terima-pesan', 'selesai')

    expect(broadcast).not.toHaveBeenCalled()
    expect(traceRunId(tracer)).toBeUndefined()
    expect(traceSnapshot(tracer)).toBeUndefined()
  })
})

// Lapisan yang benar-benar dipakai inbound.ts/orchestrator.ts. Jaminannya harus berlaku untuk
// tracer APA PUN -- termasuk yang setiap metodenya melempar -- karena yang dipasang di jalur
// panas adalah objek yang datang dari luar.
describe('helper terlindung (traceStep/traceClose/traceSnapshot/traceRunId)', () => {
  const hostile: PipelineTracer = {
    get runId(): string {
      throw new Error('runId meledak')
    },
    get conversationId(): string {
      throw new Error('conversationId meledak')
    },
    mark() {
      throw new Error('mark meledak')
    },
    closeOpen() {
      throw new Error('closeOpen meledak')
    },
    snapshot(): never {
      throw new Error('snapshot meledak')
    },
  }

  it('menelan setiap kegagalan tracer yang bermusuhan', () => {
    expect(() => traceStep(hostile, 'terima-pesan', 'selesai')).not.toThrow()
    expect(() => traceClose(hostile, 'gagal')).not.toThrow()
    expect(traceSnapshot(hostile)).toBeUndefined()
    expect(traceRunId(hostile)).toBeUndefined()
  })

  it('menerima tracer yang tidak ada sama sekali', () => {
    expect(() => traceStep(undefined, 'terima-pesan', 'selesai')).not.toThrow()
    expect(() => traceClose(undefined, 'gagal')).not.toThrow()
    expect(traceSnapshot(undefined)).toBeUndefined()
    expect(traceRunId(undefined)).toBeUndefined()
  })

  it('openPipelineRun mengembalikan tracer kosong, bukan melempar, bila pembuatan run gagal', () => {
    // Satu-satunya cara `createPipelineTracer` bisa gagal di produksi adalah lingkungan tanpa
    // Web Crypto; disimulasikan di sini dengan merusak `crypto` global.
    const asli = globalThis.crypto
    // @ts-expect-error sengaja dirusak untuk mensimulasikan runtime tanpa Web Crypto
    delete globalThis.crypto

    try {
      const tracer = openPipelineRun('conv_1')
      expect(() => traceStep(tracer, 'terima-pesan', 'selesai')).not.toThrow()
      // Fallback id tetap ada, jadi run masih bisa dirujuk kanvas.
      expect(traceRunId(tracer)).toMatch(/^run_/)
    } finally {
      globalThis.crypto = asli
    }
  })

  it('traceSnapshot mengembalikan undefined untuk run tanpa satu pun step, bukan array kosong', () => {
    // `undefined` di sana berarti kolom `steps` tetap NULL -- "run ini tidak diinstrumentasi",
    // yang berbeda dari "run ini punya nol langkah".
    expect(traceSnapshot(createPipelineTracer('conv_1'))).toBeUndefined()
  })
})
