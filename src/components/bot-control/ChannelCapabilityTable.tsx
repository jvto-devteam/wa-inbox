'use client'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  CHANNEL_CAPABILITIES,
  officialOnlyCapabilities,
  type CapabilityValue,
  type ChannelCapability,
} from '@/lib/bot-control/channel-capabilities'

const LABELS: Record<ChannelCapability, string> = {
  receive_webhook: 'Terima webhook',
  send_text: 'Kirim teks',
  send_media: 'Kirim media',
  send_document: 'Kirim dokumen',
  send_audio: 'Kirim audio',
  send_template: 'Kirim template',
  send_carousel: 'Kirim carousel',
  send_buttons: 'Kirim tombol',
  send_list: 'Kirim list',
  delivery_status: 'Status pengiriman',
  read_receipt: 'Tanda dibaca',
  campaign: 'Campaign',
}

function CapabilityCell({ value }: { value: CapabilityValue }) {
  if (value === 'LIMITED') return <Badge variant="warning">Terbatas</Badge>
  return <Badge variant={value ? 'success' : 'muted'}>{value ? 'Bisa' : 'Tidak'}</Badge>
}

/**
 * The capability matrix, rendered so an operator can see WHY a feature is Official-only rather
 * than discovering it when a send silently does nothing.
 */
export function ChannelCapabilityTable() {
  const officialOnly = new Set(officialOnlyCapabilities())
  const capabilities = Object.keys(CHANNEL_CAPABILITIES.OFFICIAL) as ChannelCapability[]

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Kemampuan</TableHead>
          <TableHead>Official</TableHead>
          <TableHead>Unofficial</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {capabilities.map((capability) => (
          <TableRow key={capability}>
            <TableCell className="text-sm text-foreground">{LABELS[capability]}</TableCell>
            <TableCell>
              <CapabilityCell value={CHANNEL_CAPABILITIES.OFFICIAL[capability]} />
            </TableCell>
            <TableCell>
              <CapabilityCell value={CHANNEL_CAPABILITIES.UNOFFICIAL[capability]} />
            </TableCell>
            <TableCell>
              {officialOnly.has(capability) && <Badge variant="brand">Official only</Badge>}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
