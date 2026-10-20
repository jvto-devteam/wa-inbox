import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { BookingApprovalPanel, type ApprovalValues } from './BookingApprovalPanel'

const values: ApprovalValues = { bookingLightApproval: 'APPROVE', bookingBaliApproval: 'APPROVE', dataRequestApproval: 'ALWAYS' }

describe('BookingApprovalPanel', () => {
  it('shows the three switches with their labels, the fixed ops note, and 44px controls', () => {
    render(<BookingApprovalPanel values={values} disabled={false} onSave={vi.fn()} />)
    expect(screen.getByRole('heading', { name: 'Persetujuan perubahan booking' })).toBeInTheDocument()
    for (const label of ['Perubahan yang bisa diubah AI', 'Perubahan dengan transport Bali', 'Pesan permintaan data ke tamu']) {
      expect(screen.getByLabelText(label).className).toContain('min-h-11')
    }
    expect(screen.getByLabelText('Perubahan yang bisa diubah AI')).toHaveValue('APPROVE')
    expect(screen.getByLabelText('Pesan permintaan data ke tamu')).toHaveValue('ALWAYS')
    expect(screen.getByText('Tugas ops (tanggal, jumlah orang, hotel, Bali) selalu ke ops.')).toBeInTheDocument()
  })

  it('saves the chosen mode for that field only', async () => {
    const onSave = vi.fn().mockResolvedValue(null)
    render(<BookingApprovalPanel values={values} disabled={false} onSave={onSave} />)
    fireEvent.change(screen.getByLabelText('Perubahan yang bisa diubah AI'), { target: { value: 'ALWAYS' } })
    await waitFor(() => expect(onSave).toHaveBeenCalledWith('bookingLightApproval', 'ALWAYS'))
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('shows the server error and is disabled for non-admins', async () => {
    const onSave = vi.fn().mockResolvedValue('Data pengaturan tidak valid')
    const { rerender } = render(<BookingApprovalPanel values={values} disabled={false} onSave={onSave} />)
    fireEvent.change(screen.getByLabelText('Perubahan dengan transport Bali'), { target: { value: 'ALWAYS' } })
    expect(await screen.findByRole('alert')).toHaveTextContent('Data pengaturan tidak valid')
    rerender(<BookingApprovalPanel values={values} disabled onSave={onSave} />)
    expect(screen.getByLabelText('Perubahan yang bisa diubah AI')).toBeDisabled()
  })
})
