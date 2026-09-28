import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/require-admin'
import { hasValidCronSecret } from '@/lib/outbound/cron-auth'
import { syncAllMailAccounts } from '@/lib/gmail/sync'

/**
 * POST /api/email/sync — tarik email semua kotak surat, dan perpanjang watch() yang hampir mati.
 *
 * Dua pemanggil: crontab VPS tiap 15 menit dengan header `x-cron-secret`, dan admin yang
 * menekan "Sinkron sekarang" di Pengaturan. Secret dicek ulang di sini, bukan hanya di
 * middleware -- alasan yang sama dengan POST /api/daily-summary/generate.
 *
 * Respons hanya memuat alamat dan kategori error: tidak ada token, tidak ada teks error mentah.
 */
export async function POST(req: Request) {
  const authorized = hasValidCronSecret(req) || (await requireAdmin(req)) !== null
  if (!authorized) {
    return NextResponse.json({ error: 'Hanya admin atau scheduler yang bisa menyinkronkan email' }, { status: 403 })
  }
  try {
    return NextResponse.json({ results: await syncAllMailAccounts() })
  } catch {
    return NextResponse.json({ error: 'Gagal menyinkronkan email' }, { status: 500 })
  }
}
