import { Badge } from '@/components/ui/badge'
import type { ConversationReview } from '@/lib/daily-summary/payload-schema'

/**
 * Status review LLM sebagai POTRET pada hari ringkasan itu dibuat ("Saat itu: ..."), bukan status
 * sekarang. Gayanya sengaja netral (abu-abu, tidak pernah merah): di tanggal lama, "Perlu tindakan"
 * berwarna merah terbaca seolah pekerjaannya masih menggantung. Hanya status tindak lanjut live
 * (`SummaryItem`) yang memakai warna kuat.
 */
const SNAPSHOT_LABEL: Record<ConversationReview['status'], string> = {
  perlu_tindakan: 'Saat itu: perlu tindakan',
  selesai: 'Saat itu: selesai',
  tidak_jelas: 'Saat itu: tidak jelas',
}

export function snapshotStatusLabel(status: ConversationReview['status']): string {
  return SNAPSHOT_LABEL[status]
}

export function SnapshotStatusBadge({ status }: { status: ConversationReview['status'] }) {
  return <Badge variant="muted">{snapshotStatusLabel(status)}</Badge>
}
