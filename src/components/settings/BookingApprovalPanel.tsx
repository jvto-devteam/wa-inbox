'use client'
import { useState } from 'react'
import { Select } from '@/components/ui/select'
import { Field, FieldError } from '@/components/ui/label'
import { FormSection } from './section'

export type ApprovalField = 'bookingLightApproval' | 'bookingBaliApproval' | 'dataRequestApproval'
export type ApprovalMode = 'APPROVE' | 'ALWAYS'
export type ApprovalValues = Record<ApprovalField, ApprovalMode>

const FIELDS: ReadonlyArray<{ field: ApprovalField; label: string; hint: string; always: string }> = [
  {
    field: 'bookingLightApproval',
    label: 'Perubahan yang bisa diubah AI',
    hint: 'Titik, jam, dan detail jemput/antar di Surabaya, ukuran kaos.',
    always: 'Terapkan otomatis',
  },
  {
    field: 'bookingBaliApproval',
    label: 'Perubahan dengan transport Bali',
    hint: 'Booking dengan transport Bali. Vendor transport Bali tetap dikabari otomatis begitu perubahan ditulis.',
    always: 'Terapkan otomatis',
  },
  {
    field: 'dataRequestApproval',
    label: 'Pesan permintaan data ke tamu',
    hint: 'Draf pesan yang meminta data yang masih kurang (mulai H-7).',
    always: 'Kirim otomatis',
  },
]

/**
 * Persetujuan perubahan booking (Task 11b). "Setujui dulu" = kartu menunggu klik; otomatis = ditulis ke booking
 * produksi begitu kartu dibuat, dan masih bisa "Batalkan" dari Inbox. Tersimpan saat pilihan diganti (edit -> simpan
 * -> aktif). Hanya admin yang boleh menyimpan; yang lain melihatnya nonaktif.
 */
export function BookingApprovalPanel({
  values,
  disabled,
  onSave,
}: {
  values: ApprovalValues
  disabled: boolean
  /** Mengembalikan pesan galat, atau null bila tersimpan. */
  onSave: (field: ApprovalField, value: ApprovalMode) => Promise<string | null>
}) {
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState<ApprovalField | null>(null)

  async function change(field: ApprovalField, value: ApprovalMode) {
    setSaving(field)
    setError(await onSave(field, value))
    setSaving(null)
  }

  return (
    <FormSection
      title="Persetujuan perubahan booking"
      description="Permintaan perubahan dari chat bisa menunggu Setujui, atau langsung ditulis ke booking tanpa klik. Yang otomatis tetap bisa dibatalkan dari Inbox."
    >
      <div className="flex flex-col gap-4">
        {FIELDS.map(({ field, label, hint, always }) => (
          <Field key={field} label={label} htmlFor={`approval-${field}`} hint={hint} className="max-w-md">
            <Select
              id={`approval-${field}`}
              className="min-h-11 w-full"
              value={values[field]}
              disabled={disabled || saving === field}
              onChange={(e) => void change(field, e.target.value === 'ALWAYS' ? 'ALWAYS' : 'APPROVE')}
            >
              <option value="APPROVE">Setujui dulu</option>
              <option value="ALWAYS">{always}</option>
            </Select>
          </Field>
        ))}
        <p className="max-w-md text-sm text-ink-muted">Tugas ops (tanggal, jumlah orang, hotel, Bali) selalu ke ops.</p>
        {error && <FieldError className="text-sm">{error}</FieldError>}
      </div>
    </FormSection>
  )
}
