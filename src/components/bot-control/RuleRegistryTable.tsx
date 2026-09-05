'use client'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { BotRule, RuleSeverity } from '@/lib/bot-control/rule-registry'

export type RuleRow = BotRule & { liveStateUnavailable?: true }

const SEVERITY_VARIANT: Record<RuleSeverity, 'muted' | 'default' | 'warning' | 'destructive'> = {
  LOW: 'muted',
  NORMAL: 'default',
  HIGH: 'warning',
  CRITICAL: 'destructive',
}

/**
 * Tabel aturan bot, read-only.
 *
 * Tidak ada toggle di sini — bahkan untuk baris `editable: true`. Fase ini hanya membuka
 * (guidebook §23, Phase 1: "tidak ada perubahan behavior"). Kolom "Dapat diubah" menjawab
 * pertanyaan yang berbeda dan lebih penting dulu: aturan mana yang NANTI boleh dikelola dari
 * UI, dan mana yang memang tidak akan pernah boleh. Menaruh saklar mati di sini akan
 * membuat operator percaya mereka sudah mematikan sesuatu.
 */
export function RuleRegistryTable({ rules }: { rules: RuleRow[] }) {
  if (rules.length === 0) {
    return <p className="text-sm text-muted-foreground">Tidak ada aturan yang cocok dengan filter.</p>
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Aturan</TableHead>
          <TableHead>Kategori</TableHead>
          <TableHead>Tingkat</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Dapat diubah</TableHead>
          <TableHead>Sumber</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rules.map((rule) => (
          <TableRow key={rule.key}>
            <TableCell className="align-top">
              <p className="font-medium text-navy">{rule.name}</p>
              <p className="font-mono text-xs text-muted-foreground">{rule.key}</p>
              <p className="mt-1 max-w-xl text-xs text-muted-foreground">{rule.description}</p>
            </TableCell>
            <TableCell className="align-top text-xs text-muted-foreground">{rule.category}</TableCell>
            <TableCell className="align-top">
              <Badge variant={SEVERITY_VARIANT[rule.severity]}>{rule.severity}</Badge>
            </TableCell>
            <TableCell className="align-top">
              <Badge variant={rule.enabled ? 'success' : 'muted'}>{rule.enabled ? 'Aktif' : 'Nonaktif'}</Badge>
              {/* Status yang tidak terbaca ditampilkan sebagai tidak terbaca. Menampilkan
                  default statis seolah-olah itu keadaan sebenarnya adalah kegagalan diam
                  yang paling berbahaya di halaman ini. */}
              {rule.liveStateUnavailable && (
                <p className="mt-1 text-xs text-destructive">Status live tidak terbaca</p>
              )}
            </TableCell>
            <TableCell className="align-top">
              <Badge variant={rule.editable ? 'brand' : 'muted'}>{rule.editable ? 'Ya' : 'Terkunci'}</Badge>
            </TableCell>
            <TableCell className="align-top">
              <p className="font-mono text-xs text-muted-foreground">{rule.sourceFile}</p>
              {rule.sourceRef && <p className="font-mono text-xs text-muted-foreground">{rule.sourceRef}()</p>}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
