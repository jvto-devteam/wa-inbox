import type { EmailAddress } from './parse'
import type { GmailMessage } from './types'

/**
 * Apakah email ini dikirim MESIN (newsletter, notifikasi, balasan otomatis), bukan manusia.
 *
 * Deterministik dan murah: hanya membaca sinyal yang dipasang pengirimnya sendiri (header
 * milis/massal, Auto-Submitted RFC 3834, alamat mesin) atau vonis kategori Gmail. Tidak ada
 * LLM -- pelabel LEAD/OPERASIONAL/BISING (spec §6.4, fase 3b) yang nanti menyaring lebih halus.
 *
 * Hasilnya LABEL, bukan gerbang (Conversation.mailAutomated): email tetap masuk ke Inbox.
 * Kesalahan ke arah "otomatis" hanya membuat satu benang absen dari daily summary, bukan hilang.
 */
const BULK_HEADERS = ['list-unsubscribe', 'list-id']
const BULK_PRECEDENCE = /^(bulk|list|junk)$/i
const MACHINE_LOCAL_PART = /^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|notifications?|bounces?)([+._-].*)?$/i
const GMAIL_AUTOMATED_CATEGORIES = new Set(['CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL', 'CATEGORY_UPDATES', 'CATEGORY_FORUMS'])

export function isAutomatedEmail(message: GmailMessage, from: EmailAddress | null): boolean {
  const headers = new Map<string, string>()
  for (const h of message.payload?.headers ?? []) headers.set(h.name.toLowerCase(), h.value.trim())

  if (BULK_HEADERS.some((name) => headers.has(name))) return true
  if (BULK_PRECEDENCE.test(headers.get('precedence') ?? '')) return true
  const autoSubmitted = headers.get('auto-submitted')
  if (autoSubmitted && autoSubmitted.toLowerCase() !== 'no') return true

  if (from && MACHINE_LOCAL_PART.test(from.address.split('@')[0] ?? '')) return true

  return (message.labelIds ?? []).some((label) => GMAIL_AUTOMATED_CATEGORIES.has(label))
}
