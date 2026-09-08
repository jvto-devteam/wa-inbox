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
          {/* Lebar tetap, bukan pecahan: tabel ini sekarang duduk di kolom yang lebarnya
              berubah-ubah, dan `w-1/2` membuat kolom nama tumbuh mengikuti wadah sementara
              tiga kolom lencana di sebelahnya justru makin renggang. */}
          <TableHead>Kemampuan</TableHead>
          <TableHead className="w-32">Official</TableHead>
          <TableHead className="w-32">Unofficial</TableHead>
          <TableHead className="w-44">Catatan</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {capabilities.map((capability) => (
          <TableRow key={capability}>
            <TableCell className="text-base font-medium text-ink">{LABELS[capability]}</TableCell>
            <TableCell>
              <CapabilityCell value={CHANNEL_CAPABILITIES.OFFICIAL[capability]} />
            </TableCell>
            <TableCell>
              <CapabilityCell value={CHANNEL_CAPABILITIES.UNOFFICIAL[capability]} />
            </TableCell>
            <TableCell>
              {/* "-" alih-alih sel kosong, sama seperti tabel Kontak: sel yang benar-benar
                  kosong tidak bisa dibedakan dari sel yang gagal dirender. */}
              {officialOnly.has(capability) ? (
                <Badge variant="warning">Official only</Badge>
              ) : (
                <span className="text-ink-subtle">-</span>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
