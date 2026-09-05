'use client'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { ExistingFlowNode, ExistingFlowNodeType } from '@/lib/bot-control/existing-flow-registry'

// Warna per tipe node. Tujuannya bukan dekorasi: seorang operator yang men-scan 28 langkah
// perlu langsung melihat mana gerbang (bisa menghentikan pesan), mana pemanggilan LLM (bisa
// gagal/lambat), dan mana pengiriman (menyentuh customer sungguhan).
const TYPE_VARIANT: Record<ExistingFlowNodeType, 'brand' | 'warning' | 'success' | 'muted' | 'destructive'> = {
  webhook: 'brand',
  guard: 'warning',
  classifier: 'muted',
  lookup: 'muted',
  knowledge: 'success',
  llm: 'brand',
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
        'w-full rounded-lg border p-3 text-left transition-colors',
        selected ? 'border-brand bg-brand/5' : 'border-border bg-white hover:bg-muted/50'
      )}
    >
      <div className="flex items-center gap-2">
        <span className="w-6 shrink-0 font-mono text-xs text-muted-foreground">{node.order}</span>
        <span className="flex-1 text-sm font-medium text-navy">{node.name}</span>
        <Badge variant={TYPE_VARIANT[node.type]}>{TYPE_LABEL[node.type]}</Badge>
      </div>
      <p className="mt-1 pl-8 font-mono text-xs text-muted-foreground">{node.sourceFile}</p>
    </button>
  )
}

export { TYPE_LABEL as FLOW_NODE_TYPE_LABEL }
