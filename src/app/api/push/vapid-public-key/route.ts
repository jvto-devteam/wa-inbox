import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/get-session'

/** Kunci PUBLIK VAPID untuk `pushManager.subscribe`. Kunci privat tidak pernah lewat sini. */
export async function GET(req: Request) {
  try {
    const session = await getSession(req)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const publicKey = process.env.VAPID_PUBLIC_KEY
    if (!publicKey || !process.env.VAPID_PRIVATE_KEY || !process.env.VAPID_SUBJECT) {
      return NextResponse.json({ error: 'Notifikasi push belum dikonfigurasi' }, { status: 404 })
    }
    return NextResponse.json({ publicKey })
  } catch {
    return NextResponse.json({ error: 'Gagal membaca konfigurasi push' }, { status: 500 })
  }
}
