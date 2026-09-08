'use client'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { ExistingFlowNode, ExistingFlowNodeType } from '@/lib/bot-control/existing-flow-registry'

// Warna per tipe node. Tujuannya bukan dekorasi: seorang operator yang men-scan 28 langkah
// perlu langsung melihat mana gerbang (bisa menghentikan pesan), mana pemanggilan LLM (bisa
// gagal/lambat), dan mana pengiriman (menyentuh customer sungguhan).
const TYPE_VARIANT: Record<ExistingFlowNodeType, 'default' | 'warning' | 'success' | 'muted' | 'destructive'> = {
  webhook: 'default',
  guard: 'warning',
  classifier: 'muted',
  lookup: 'muted',
  knowledge: 'success',
  llm: 'default',
  verification: 'warning',
  send: 'success',
  handoff: 'destructive',
}

const TYPE_LABEL: Record<ExistingFlowNodeType, string> = {
  webhook: 'Webhook',
  guard: 'Gerbang',
  classifier: 'Klasifikasi',
  lookup: 'Pencarian',
  knowledge: 'Knowledge',
  llm: 'LLM',
  verification: 'Verifikasi',
  send: 'Kirim',
  handoff: 'Handoff',
}

export function FlowStepCard({
  node,
  selected,
  onSelect,
}: {
  node: ExistingFlowNode
  selected: boolean
  onSelect: (id: string) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(node.id)}
      // aria-pressed, bukan aria-current: ini tombol pemilih di dalam daftar, bukan penanda
      // halaman/lokasi navigasi.
      aria-pressed={selected}
      className={cn(
        'focus-ring w-full rounded-md px-2 py-2 text-left transition-colors',
        selected ? 'bg-accent-subtle' : 'hover:bg-surface-sunken'
      )}
    >
      <div className="flex items-center gap-2">
        <span className="w-5 shrink-0 font-mono text-xs text-ink-subtle">{node.order}</span>
        <span className={cn('flex-1 text-base font-medium', selected ? 'text-accent' : 'text-ink')}>{node.name}</span>
        <Badge variant={TYPE_VARIANT[node.type]}>{TYPE_LABEL[node.type]}</Badge>
      </div>
      <p className="pl-7 font-mono text-xs break-all text-ink-muted">{node.sourceFile}</p>
    </button>
  )
}

export { TYPE_LABEL as FLOW_NODE_TYPE_LABEL }
