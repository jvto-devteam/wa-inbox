'use client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { BotRule, RuleSeverity } from '@/lib/bot-control/rule-registry'

export type RuleRow = BotRule & {
  liveStateUnavailable?: true
  status: string
  hasDraft: boolean
  draftEnabled: boolean | null
  draftConfig: Record<string, unknown> | null
  draftUpdatedAt: string | null
  runtimeSource: string | null
  editSurface: { canToggleEnabled: boolean; fields: readonly string[] } | null
}

const SEVERITY_VARIANT: Record<RuleSeverity, 'muted' | 'default' | 'warning' | 'destructive'> = {
  LOW: 'muted',
  NORMAL: 'default',
  HIGH: 'warning',
  CRITICAL: 'destructive',
}

const STATUS_VARIANT: Record<string, 'success' | 'brand' | 'warning' | 'destructive' | 'muted'> = {
  PUBLISHED: 'success',
  DRAFT: 'brand',
  REVIEW: 'warning',
  APPROVED: 'brand',
  REJECTED: 'destructive',
}

export type RuleAction = 'edit' | 'request-review' | 'approve' | 'reject'

/**
 * Tabel aturan bot, dengan kontrol draft untuk baris yang memang boleh diubah.
 *
 * Kontrol muncul HANYA kalau `editSurface` tidak null — dan `editSurface` diturunkan dari
 * registry statis di server, bukan dari baris database. Menampilkan saklar untuk aturan
 * terkunci jauh lebih buruk daripada tidak menampilkan apa-apa: operator akan percaya mereka
 * sudah mematikan sesuatu, padahal kodenya tidak pernah membacanya.
 *
 * Tombolnya juga mengikuti status, bukan sekadar peran. "Kirim ke review" pada baris yang
 * belum punya draft, atau "Approve" pada baris yang belum direview, hanya akan ditolak API
 * dengan 409 — dan tombol yang selalu gagal mengajarkan operator untuk berhenti mempercayai
 * halaman ini.
 */
export function RuleRegistryTable({
  rules,
  canEdit = false,
  canApprove = false,
  onAction,
}: {
  rules: RuleRow[]
  canEdit?: boolean
  canApprove?: boolean
  onAction?: (rule: RuleRow, action: RuleAction) => void
}) {
  if (rules.length === 0) {
    return <p className="text-sm text-muted-foreground">Tidak ada aturan yang cocok dengan filter.</p>
  }

  const showActions = (canEdit || canApprove) && onAction !== undefined

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
          {showActions && <TableHead>Aksi</TableHead>}
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
              {/* Status draft dipisahkan dari status aktif: yang satu menjawab "apa yang bot
                  lakukan sekarang", yang lain "apa yang sedang diusulkan". Menggabungkannya
                  akan membuat draft terbaca seolah sudah berlaku. */}
              {rule.hasDraft && (
                <p className="mt-1">
                  <Badge variant={STATUS_VARIANT[rule.status] ?? 'muted'}>Draft: {rule.status}</Badge>
                </p>
              )}
              {rule.runtimeSource === 'database' && (
                <p className="mt-1 text-xs text-muted-foreground">Dikelola dari Bot Control</p>
              )}
            </TableCell>
            <TableCell className="align-top">
              <Badge variant={rule.editable ? 'brand' : 'muted'}>{rule.editable ? 'Ya' : 'Terkunci'}</Badge>
              {/* Aturan CRITICAL yang tetap editable perlu dijelaskan, bukan sekadar ditandai:
                  yang boleh diubah adalah nilainya, bukan keberadaan aturannya. */}
              {rule.editSurface?.canToggleEnabled === false && (
                <p className="mt-1 text-xs text-muted-foreground">Hanya nilainya</p>
              )}
            </TableCell>
            <TableCell className="align-top">
              <p className="font-mono text-xs text-muted-foreground">{rule.sourceFile}</p>
              {rule.sourceRef && <p className="font-mono text-xs text-muted-foreground">{rule.sourceRef}()</p>}
            </TableCell>
            {showActions && (
              <TableCell className="align-top">
                {rule.editSurface === null ? (
                  <span className="text-xs text-muted-foreground">—</span>
                ) : (
                  <div className="flex flex-col items-start gap-1">
                    {canEdit && (
                      <Button variant="outline" size="sm" onClick={() => onAction?.(rule, 'edit')}>
                        {rule.hasDraft ? 'Ubah draft' : 'Buat draft'}
                      </Button>
                    )}
                    {canEdit && rule.status === 'DRAFT' && (
                      <Button variant="outline" size="sm" onClick={() => onAction?.(rule, 'request-review')}>
                        Kirim ke review
                      </Button>
                    )}
                    {canApprove && rule.status === 'REVIEW' && (
                      <Button variant="outline" size="sm" onClick={() => onAction?.(rule, 'approve')}>
                        Approve
                      </Button>
                    )}
                    {canApprove && rule.hasDraft && (
                      <Button variant="outline" size="sm" onClick={() => onAction?.(rule, 'reject')}>
                        Reject
                      </Button>
                    )}
                    {rule.status === 'APPROVED' && (
                      <span className="text-xs text-muted-foreground">Menunggu publish lewat Releases</span>
                    )}
                  </div>
                )}
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
