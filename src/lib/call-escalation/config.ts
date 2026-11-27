/**
 * Eskalasi telepon ke admin (owner 2026-11-27). Konfigurasi dari env VPS -- nomor telepon pribadi tidak masuk repo/DB:
 * - `ESCALATION_CALL_PHONE`  nomor yang ditelepon (satu penerima), angka saja atau berformat; kosong = fitur mati.
 * - `ESCALATION_CALL_MODE`   `live` = menelepon; `dry` = hanya mencatat DRY_RUN; selain itu / kosong = mati.
 * - `TELEPON_URL`            bawaan `http://127.0.0.1:3030` (telepon-service di VPS yang sama).
 * - `TELEPON_TOKEN`          token telepon-service (Bearer); tidak pernah dicatat.
 */
export type EscalationConfig = { phone: string; url: string; token: string; mode: 'live' | 'dry' }

/** Tunggu sesudah notif HP terkirim sebelum menelepon (owner 2026-11-27: 15 menit). Tanpa jam senyap (owner: 24 jam). */
export const WAIT_MS = 15 * 60 * 1000
/**
 * Telepon yang sudah lewat > ini dari waktu jatuh temponya tidak dilakukan lagi (layanan mati lama, atau fitur baru
 * dinyalakan): menelepon soal yang sudah basi lebih mengganggu daripada membantu.
 */
export const STALE_AFTER_MS = 60 * 60 * 1000

export function escalationConfig(env: Record<string, string | undefined> = process.env): EscalationConfig | null {
  const mode = env.ESCALATION_CALL_MODE
  if (mode !== 'live' && mode !== 'dry') return null
  const phone = (env.ESCALATION_CALL_PHONE ?? '').replace(/\D/g, '')
  const token = env.TELEPON_TOKEN ?? ''
  if (phone.length < 8 || !token) return null
  return { phone, url: (env.TELEPON_URL || 'http://127.0.0.1:3030').replace(/\/+$/, ''), token, mode }
}

/** Rekaman suara di telepon-service (`audio/<kunci>.wav`). */
export const AUDIO_BY_KIND = { REPLY: 'belum-dibalas', PROBLEM: 'komplain' } as const
