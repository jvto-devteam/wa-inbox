/**
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { WHATSAPP_EXISTING_BOT_FLOW } from '@/lib/bot-control/existing-flow-registry'
import {
  PIPELINE_ENTRY_STEP_ID,
  PIPELINE_STEPS,
  findStepBySubStepId,
  getPipelineStep,
  listPipelineEdges,
  listPipelineStepIds,
  listTerminalPipelineStepIds,
  type PipelineStepId,
} from './steps'

const repoRoot = path.resolve(__dirname, '../../..')
const stepIds = new Set<string>(PIPELINE_STEPS.map((step) => step.id))

function reachableFromEntry(): Set<string> {
  const seen = new Set<string>()
  const queue: PipelineStepId[] = [PIPELINE_ENTRY_STEP_ID]
  while (queue.length > 0) {
    const current = queue.shift() as PipelineStepId
    if (seen.has(current)) continue
    seen.add(current)
    const step = getPipelineStep(current)
    if (!step) continue
    for (const transition of step.next) queue.push(transition.to)
  }
  return seen
}

/** Semua siklus lewat DFS berwarna. Kosong berarti graf benar-benar DAG. */
function findCycles(): string[][] {
  const cycles: string[][] = []
  const state = new Map<string, 'visiting' | 'done'>()
  const stack: string[] = []

  const visit = (id: string) => {
    const current = state.get(id)
    if (current === 'done') return
    if (current === 'visiting') {
      cycles.push([...stack.slice(stack.indexOf(id)), id])
      return
    }
    state.set(id, 'visiting')
    stack.push(id)
    for (const transition of getPipelineStep(id)?.next ?? []) visit(transition.to)
    stack.pop()
    state.set(id, 'done')
  }

  for (const step of PIPELINE_STEPS) visit(step.id)
  return cycles
}

describe('registry step kasar pipeline', () => {
  it('berisi 8-12 step kasar', () => {
    expect(PIPELINE_STEPS.length).toBeGreaterThanOrEqual(8)
    expect(PIPELINE_STEPS.length).toBeLessThanOrEqual(12)
  })

  it('tidak punya dua step dengan id yang sama', () => {
    expect(stepIds.size).toBe(PIPELINE_STEPS.length)
  })

  it('tidak punya dua step dengan koordinat yang sama', () => {
    const coords = PIPELINE_STEPS.map((step) => `${step.x},${step.y}`)
    expect(new Set(coords).size).toBe(coords.length)
  })

  it('memakai koordinat numerik yang hingga', () => {
    for (const step of PIPELINE_STEPS) {
      expect(Number.isFinite(step.x), `${step.id}.x`).toBe(true)
      expect(Number.isFinite(step.y), `${step.id}.y`).toBe(true)
    }
  })

  it('memberi label dan ringkasan bahasa Indonesia pada setiap step, bukan nama fungsi', () => {
    for (const step of PIPELINE_STEPS) {
      expect(step.label.trim().length, step.id).toBeGreaterThan(0)
      expect(step.summary.trim().length, step.id).toBeGreaterThan(0)
      // Label untuk operator: tidak boleh berupa identifier camelCase/berkurung.
      expect(step.label, step.id).not.toMatch(/[(){}]|[a-z][A-Z]/)
    }
  })
})

describe('integritas graf pipeline', () => {
  it('setiap next menunjuk id step yang benar-benar ada', () => {
    for (const edge of listPipelineEdges()) {
      expect(stepIds.has(edge.to), `${edge.from} -> ${edge.to}`).toBe(true)
    }
  })

  it('tidak ada step yang menunjuk dirinya sendiri', () => {
    for (const edge of listPipelineEdges()) {
      expect(edge.from, `${edge.from} self-loop`).not.toBe(edge.to)
    }
  })

  it('tidak ada tujuan next yang terduplikasi pada satu step', () => {
    for (const step of PIPELINE_STEPS) {
      const targets = step.next.map((transition) => transition.to)
      expect(new Set(targets).size, step.id).toBe(targets.length)
    }
  })

  it('setiap percabangan memberi kondisi pada tiap cabangnya', () => {
    for (const step of PIPELINE_STEPS) {
      if (step.next.length < 2) continue
      for (const transition of step.next) {
        expect(transition.condition?.trim().length ?? 0, `${step.id} -> ${transition.to}`).toBeGreaterThan(0)
      }
    }
  })

  it('tidak ada step yatim: semuanya terjangkau dari step awal', () => {
    const reachable = reachableFromEntry()
    const orphans = PIPELINE_STEPS.map((step) => step.id).filter((id) => !reachable.has(id))
    expect(orphans).toEqual([])
  })

  it('hanya step awal yang tidak punya edge masuk', () => {
    const withIncoming = new Set(listPipelineEdges().map((edge) => edge.to))
    const roots = PIPELINE_STEPS.map((step) => step.id).filter((id) => !withIncoming.has(id))
    expect(roots).toEqual([PIPELINE_ENTRY_STEP_ID])
  })

  it('tidak mengandung siklus', () => {
    expect(findCycles()).toEqual([])
  })

  it('punya tepat satu step akhir, yaitu jalur kirim', () => {
    expect(listTerminalPipelineStepIds()).toEqual(['kirim-balasan'])
  })

  it('mencakup percabangan keputusan: balasan terkirim ATAU handoff ke manusia', () => {
    const edges = listPipelineEdges()
    const handoffSources = edges.filter((edge) => edge.to === 'serahkan-agen').map((edge) => edge.from)
    // Handoff bukan satu titik di ujung: eskalasi, gerbang/rute, knowledge kosong, dan
    // verifikasi gagal semuanya bisa menuju ke sana.
    expect(handoffSources.length).toBeGreaterThanOrEqual(3)
    expect(handoffSources).toContain('cek-eskalasi')
    expect(handoffSources).toContain('verifikasi-balasan')
    // Dan handoff sendiri tetap mengirim satu pesan pengakuan ke pelanggan.
    expect(edges).toContainEqual(
      expect.objectContaining({ from: 'serahkan-agen', to: 'kirim-balasan' })
    )
  })
})

describe('sourceRef pipeline menunjuk kode yang benar-benar ada', () => {
  const refs = [
    ...PIPELINE_STEPS.map((step) => ({ owner: step.id, ref: step.sourceRef })),
    ...PIPELINE_STEPS.flatMap((step) =>
      step.subSteps.map((sub) => ({ owner: `${step.id}/${sub.id}`, ref: sub.sourceRef }))
    ),
  ]

  it.each(refs)('$owner menunjuk file yang ada', ({ owner, ref }) => {
    expect(existsSync(path.join(repoRoot, ref.file)), `${owner}: ${ref.file}`).toBe(true)
  })

  it.each(refs)('$owner menunjuk simbol yang ada di filenya', ({ owner, ref }) => {
    const source = readFileSync(path.join(repoRoot, ref.file), 'utf8')
    expect(new RegExp(`\\b${ref.symbol}\\b`).test(source), `${owner}: ${ref.symbol}`).toBe(true)
  })
})

describe('subStep pipeline terhadap existing-flow-registry', () => {
  const subStepIds = PIPELINE_STEPS.flatMap((step) => step.subSteps.map((sub) => sub.id))

  it('memakai id node yang memang ada di registry 28 node', () => {
    const registryIds = new Set(WHATSAPP_EXISTING_BOT_FLOW.nodes.map((node) => node.id))
    const unknown = subStepIds.filter((id) => !registryIds.has(id))
    expect(unknown).toEqual([])
  })

  it('mencakup SETIAP node registry tepat satu kali', () => {
    expect([...subStepIds].sort()).toEqual(
      WHATSAPP_EXISTING_BOT_FLOW.nodes.map((node) => node.id).sort()
    )
    expect(new Set(subStepIds).size).toBe(subStepIds.length)
  })

  it('mempertahankan urutan node registry di dalam tiap step', () => {
    const registryOrder = new Map(WHATSAPP_EXISTING_BOT_FLOW.nodes.map((node) => [node.id, node.order]))
    for (const step of PIPELINE_STEPS) {
      const orders = step.subSteps.map((sub) => registryOrder.get(sub.id) ?? -1)
      expect(orders, step.id).toEqual([...orders].sort((a, b) => a - b))
    }
  })
})

describe('helper pipeline', () => {
  it('getPipelineStep mengembalikan step yang cocok dan null untuk id asing', () => {
    expect(getPipelineStep('cek-booking')?.label).toBe('Cek booking pelanggan')
    expect(getPipelineStep('tidak-ada')).toBeNull()
  })

  it('listPipelineStepIds mengikuti urutan deklarasi', () => {
    expect(listPipelineStepIds()[0]).toBe(PIPELINE_ENTRY_STEP_ID)
    expect(listPipelineStepIds()).toHaveLength(PIPELINE_STEPS.length)
  })

  it('findStepBySubStepId memetakan node registry ke step kasar pemiliknya', () => {
    expect(findStepBySubStepId('reply-verification')?.id).toBe('verifikasi-balasan')
    expect(findStepBySubStepId('handoff-alert')?.id).toBe('serahkan-agen')
    expect(findStepBySubStepId('node-yang-tidak-ada')).toBeNull()
  })
})
