'use client'
import Link from 'next/link'
import { SearchX } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { BotRule, RuleSeverity } from '@/lib/bot-control/rule-registry'

export type RuleRow = BotRule & {
  /**
   * The rule's live on/off state.
   *
   * `null` means the rule has no switch anywhere — it is enforced unconditionally by the code in
   * `sourceFile`, and the row says "Selalu aktif" rather than showing a state that could be
   * mistaken for something an operator chose. `undefined` means the rule DOES have a switch but
   * its `Settings` column could not be read; that is shown as unreadable, never as off.
   */
  enabled: boolean | null | undefined
}

const SEVERITY_VARIANT: Record<RuleSeverity, 'muted' | 'default' | 'warning' | 'destructive'> = {
  LOW: 'muted',
  NORMAL: 'default',
  HIGH: 'warning',
  CRITICAL: 'destructive',
}

/**
 * The bot's rules, read-only.
 *
 * There is no edit control here and that is the design, not an omission. Eight of these ten
 * rules are hardcoded behaviour: a toggle for them would be an inert switch that an operator
 * presses, believes, and walks away from — worse than no switch at all. The two that are real
 * switches are single `Settings` columns edited on /chatbot, and this table links there rather
 * than becoming a second writer that could disagree with the first.
 */
export function RuleRegistryTable({ rules }: { rules: RuleRow[] }) {
  if (rules.length === 0) {
    return (
      <EmptyState
        icon={<SearchX strokeWidth={1.75} />}
        title="Tidak ada aturan yang cocok dengan filter."
        description="Registry ini berisi sepuluh aturan. Kosongkan pencarian atau pilih ulang kategorinya untuk melihat semuanya."
        className="border-t border-line"
      />
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          {/* Kolom Aturan memuat nama + kunci + deskripsi; tanpa lebar eksplisit pada lima
              kolom sisanya ia menelan seluruh tabel begitu halaman ini memakai lebar layar. */}
          <TableHead>Aturan</TableHead>
          <TableHead className="w-40">Kategori</TableHead>
          <TableHead className="w-28">Tingkat</TableHead>
          <TableHead className="w-44">Status</TableHead>
          <TableHead className="w-44">Dikelola di</TableHead>
          <TableHead className="w-80">Sumber</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rules.map((rule) => (
          <TableRow key={rule.key}>
            <TableCell className="align-top py-2.5">
              <p className="font-medium text-ink">{rule.name}</p>
              <p className="font-mono text-xs text-ink-subtle">{rule.key}</p>
              <p className="mt-1 max-w-xl text-sm text-ink-muted">{rule.description}</p>
            </TableCell>
            <TableCell className="align-top text-sm whitespace-nowrap text-ink-muted">{rule.category}</TableCell>
            <TableCell className="align-top">
              <Badge variant={SEVERITY_VARIANT[rule.severity]}>{rule.severity}</Badge>
            </TableCell>
            <TableCell className="align-top">
              {rule.enabled === null ? (
                <>
                  <Badge variant="success">Selalu aktif</Badge>
                  <p className="mt-1 text-xs text-ink-subtle">Tidak ada sakelarnya</p>
                </>
              ) : rule.enabled === undefined ? (
                // A state that could not be read is shown as unread. Showing a default as if it
                // were the truth is the most dangerous silent failure this page can have.
                <p className="text-xs text-danger">Status tidak terbaca</p>
              ) : (
                <Badge variant={rule.enabled ? 'success' : 'muted'}>{rule.enabled ? 'Aktif' : 'Nonaktif'}</Badge>
              )}
            </TableCell>
            <TableCell className="align-top text-sm whitespace-nowrap text-ink-muted">
              {rule.settingsKey ? (
                <Link href="/chatbot" className="focus-ring rounded-sm text-accent hover:underline">
                  Chatbot
                </Link>
              ) : rule.managedIn ? (
                <Link href={rule.managedIn.href} className="focus-ring rounded-sm text-accent hover:underline">
                  {rule.managedIn.label}
                </Link>
              ) : (
                // "Kode" sendirian membuat operator mencari tombol yang tidak ada. Menyebut
                // bahwa perubahannya butuh deploy menutup pencarian itu.
                <span>Kode — perlu deploy</span>
              )}
            </TableCell>
            <TableCell className="align-top">
              <p className="font-mono text-xs break-all text-ink-muted">{rule.sourceFile}</p>
              {rule.sourceRef && <p className="font-mono text-xs text-ink-subtle">{rule.sourceRef}()</p>}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
