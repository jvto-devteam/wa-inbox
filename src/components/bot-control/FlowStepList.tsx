'use client'
import { FlowStepCard } from './FlowStepCard'
import type { ExistingFlowNode } from '@/lib/bot-control/existing-flow-registry'

/**
 * Daftar langkah bot, dalam urutan eksekusi sebenarnya.
 *
 * Urutannya diberlakukan di sini lewat `order`, bukan dipercaya dari urutan array. Array-nya
 * memang sudah urut hari ini, tetapi urutan langkah adalah SATU-SATUNYA hal yang dijanjikan
 * halaman ini; menggantungkannya pada urutan penulisan literal berarti sebuah node yang
 * disisipkan di tempat salah akan diam-diam menggambarkan pipeline yang tidak pernah ada.
 */
export function FlowStepList({
  nodes,
  selectedId,
  onSelect,
}: {
  nodes: ExistingFlowNode[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  if (nodes.length === 0) {
    return <p className="text-sm text-muted-foreground">Flow ini belum punya langkah.</p>
  }

  const ordered = [...nodes].sort((a, b) => a.order - b.order)

  return (
    <ol aria-label="Langkah flow bot" className="space-y-2">
      {ordered.map((node) => (
        <li key={node.id}>
          <FlowStepCard node={node} selected={node.id === selectedId} onSelect={onSelect} />
        </li>
      ))}
    </ol>
  )
}
