/**
 * Tujuan kabar vendor (Bali dan kaos) dengan gerbang uji (review 2026-10-20, Important 4).
 *
 * Selama rollout `test` (R25) satu-satunya percakapan yang bisa menulis booking otomatis adalah percakapan uji
 * (`isTest` atau nomor `BOOKING_ACTIONS_TEST_PHONES`). Kabar vendor dari percakapan itu TIDAK boleh sampai ke vendor
 * sungguhan: ia dialihkan ke nomor uji PERTAMA di env. Tanpa nomor uji = tidak dikirim (`TEST_PHONE_MISSING`).
 * Rollout `all`: tujuan sungguhan untuk semua percakapan. Selama `test`, gagal membaca percakapan = tidak dikirim
 * (`LOOKUP_FAILED`, pemanggil memperlakukannya sebagai kabar gagal: event + push manual).
 * Nomor tidak pernah dicatat.
 */
import { prisma } from '@/lib/db'
import { bookingActionsRollout, firstBookingTestPhone, isBookingTestConversation } from './rollout'

export type VendorDestination = { phone: string; test: boolean } | { skip: 'TEST_PHONE_MISSING' | 'LOOKUP_FAILED' }

export async function vendorDestination(conversationId: string, vendorPhone: string): Promise<VendorDestination> {
  if (bookingActionsRollout() !== 'test') return { phone: vendorPhone, test: false }
  let conv: { isTest: boolean; contact: { phone: string | null } | null } | null = null
  try {
    conv = await prisma.conversation.findUnique({ where: { id: conversationId }, select: { isTest: true, contact: { select: { phone: true } } } })
  } catch {
    return { skip: 'LOOKUP_FAILED' }
  }
  if (!conv) return { skip: 'LOOKUP_FAILED' }
  if (!isBookingTestConversation({ isTest: conv.isTest, phone: conv.contact?.phone ?? null })) {
    return { phone: vendorPhone, test: false }
  }
  const testPhone = firstBookingTestPhone()
  return testPhone ? { phone: testPhone, test: true } : { skip: 'TEST_PHONE_MISSING' }
}
