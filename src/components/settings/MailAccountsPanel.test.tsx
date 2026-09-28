import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MailAccountsPanel, describeSyncError, pushStatus, MAIL_FLASH } from './MailAccountsPanel'

describe('describeSyncError', () => {
  it('memetakan setiap kategori ke kalimat yang bisa ditindaklanjuti', () => {
    expect(describeSyncError(null)).toBeNull()
    expect(describeSyncError('AUTH_REVOKED')).toContain('Sambungkan ulang')
    expect(describeSyncError('WATCH_FAILED')).toContain('15 menit')
    expect(describeSyncError('KATEGORI_BARU')).toContain('KATEGORI_BARU')
  })
})

describe('pushStatus', () => {
  const now = new Date('2026-09-28T00:00:00Z')
  it('push tidak dikonfigurasi terlihat sebagai peringatan, bukan diam', () => {
    expect(pushStatus(null, false, now)).toEqual({ label: 'Push mati — hanya tarikan 15 menit', tone: 'warning' })
  })
  it('watch yang sudah lewat terlihat sebagai peringatan', () => {
    expect(pushStatus('2026-09-27T00:00:00Z', true, now).tone).toBe('warning')
  })
  it('watch aktif', () => {
    expect(pushStatus('2026-10-03T00:00:00Z', true, now).tone).toBe('success')
  })
})

describe('MailAccountsPanel', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        pushConfigured: true,
        items: [{
          id: 'mail_1', emailAddress: 'hello@javavolcano-touroperator.com', watchExpiresAt: '2099-01-01T00:00:00Z',
          lastSyncAt: '2026-09-28T00:00:00Z', lastSyncError: 'AUTH_REVOKED', createdAt: '2026-09-28T00:00:00Z',
        }],
      }),
    }))
  })

  it('menampilkan alamat dan error sinkronisasi yang bisa ditindaklanjuti', async () => {
    render(<MailAccountsPanel />)
    await waitFor(() => expect(screen.getByText('hello@javavolcano-touroperator.com')).toBeInTheDocument())
    expect(screen.getByText(/Sambungkan ulang/)).toBeInTheDocument()
  })

  it('tombol sambungkan menuju endpoint OAuth', async () => {
    render(<MailAccountsPanel />)
    const link = await screen.findByRole('link', { name: 'Sambungkan kotak surat' })
    expect(link).toHaveAttribute('href', '/api/mail-accounts/oauth/start')
  })

  it('setiap hasil callback punya pesan', () => {
    for (const key of ['tersambung', 'dibatalkan', 'state-tidak-cocok', 'tanpa-refresh-token', 'izin-kurang', 'gagal']) {
      expect(MAIL_FLASH[key]).toBeTruthy()
    }
  })
})
