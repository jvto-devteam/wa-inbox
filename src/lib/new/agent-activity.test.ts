import { describe, expect, it } from 'vitest'
import { TEMPLATE_AGENT, fromEvent, fromJob, fromReview, fromRun, fromSummary, sortActivities } from './agent-activity'
import { SYSTEM_TEMPLATE_SEEDS } from '@/lib/system-templates/seed-data'

const at = new Date('2026-11-24T03:00:00Z')

describe('poin penting diperbarui', () => {
  const base = { id: 'c', chatReviewAt: at, open: true }
  const pts = [{ teks: 'Minta jemput 06:30', messageId: 'm1', jenis: 'jemput' }, 'Poin lama tanpa jenis']

  it('bukti = isi poin penting; jumlah sebelumnya disebut bila berubah; tanpa Masukan', () => {
    const a = fromReview({ ...base, points: pts, prev: 4 }, 'Vytas')!
    expect(a).toMatchObject({ agent: 'poin', status: 'ok', contact: 'Vytas', input: '', output: '2 poin penting (sebelumnya 4) · masih perlu tindakan' })
    expect(a.points).toEqual([{ teks: 'Minta jemput 06:30', jenis: 'jemput' }, { teks: 'Poin lama tanpa jenis', jenis: null }])
    expect(fromReview({ ...base, points: pts, prev: 2 }, null)!.output).toBe('2 poin penting · masih perlu tindakan')
  })

  it('0 poin disembunyikan bila sebelumnya juga 0 atau belum pernah diringkas; 4 → 0 tetap tampil', () => {
    expect(fromReview({ ...base, points: [], prev: 0 }, null)).toBeNull()
    expect(fromReview({ ...base, points: [], prev: null }, null)).toBeNull()
    expect(fromReview({ ...base, points: [], prev: 4, open: false }, null)?.output).toBe('0 poin penting (sebelumnya 4) · selesai')
  })
})

describe('riwayat agent dari log yang ada', () => {
  it('keputusan bot -> agent Balas pesan; SKIPPED/SIMULATED diabaikan', () => {
    expect(fromRun({ id: 'r', conversationId: 'c', status: 'REPLIED', inboundText: 'Ijen buka?', replyText: 'Buka 01:00', error: null, startedAt: at }, 'Tom'))
      .toMatchObject({ agent: 'balas', status: 'ok', title: 'Membalas pesan tamu', contact: 'Tom', output: 'Balasan: "Buka 01:00"' })
    expect(fromRun({ id: 'r', conversationId: 'c', status: 'HANDOFF', inboundText: 'x', replyText: null, error: null, startedAt: at }, null)?.status).toBe('tunggu')
    expect(fromRun({ id: 'r', conversationId: 'c', status: 'SKIPPED', inboundText: 'x', replyText: null, error: null, startedAt: at }, null)).toBeNull()
    expect(fromRun({ id: 'r', conversationId: 'c', status: 'SIMULATED', inboundText: 'x', replyText: null, error: null, startedAt: at }, null)).toBeNull()
  })

  it('pesan sistem -> agent sesuai template; template di luar daftar diabaikan', () => {
    expect(fromJob({ id: 'j', conversationId: null, templateKey: 'payment_reminder_balance', status: 'SENT', lastError: null, createdAt: at }, null, 'Pengingat pelunasan'))
      .toMatchObject({ agent: 'reminder', status: 'ok', title: 'Pengingat pelunasan', input: 'Template payment_reminder_balance ke tamu' })
    expect(fromJob({ id: 'j', conversationId: null, templateKey: 'crew_reminder_group', status: 'FAILED', lastError: 'grup tidak ada', createdAt: at }, null, undefined))
      .toMatchObject({ agent: 'crew', status: 'gagal', output: 'Gagal terkirim: grup tidak ada' })
    expect(fromJob({ id: 'j', conversationId: null, templateKey: 'internal_new_booking', status: 'SENT', lastError: null, createdAt: at }, null, undefined)).toBeNull()
  })

  it('semua template di TEMPLATE_AGENT ada di seed (atau template crew_chat_unreplied_reminder yang menyusul)', () => {
    const seeds = new Set(SYSTEM_TEMPLATE_SEEDS.map((t) => t.key))
    expect(Object.keys(TEMPLATE_AGENT).filter((k) => !seeds.has(k))).toEqual(['crew_chat_unreplied_reminder'])
  })

  it('aksi booking: otomatis -> Update note; manual EXECUTED tidak dihitung agent', () => {
    expect(fromEvent({ id: 'e', conversationId: 'c', event: 'EXECUTED', actor: 'SYSTEM', reason: null, createdAt: at }, 'Sarah', 'pickup_time'))
      .toMatchObject({ agent: 'note', status: 'ok', title: 'Booking diperbarui dari chat: jam jemput' })
    expect(fromEvent({ id: 'e', conversationId: 'c', event: 'EXECUTED', actor: 'ACCOUNT', reason: null, createdAt: at }, null, 'pickup_time')).toBeNull()
    expect(fromEvent({ id: 'e', conversationId: 'c', event: 'VENDOR_NOTICE_FAILED', actor: 'SYSTEM', reason: null, createdAt: at }, null, 'tshirt_sizes'))
      .toMatchObject({ agent: 'vendor', status: 'gagal' })
  })

  it('ringkasan harian dan urutan terbaru dulu', () => {
    const a = fromSummary({ id: 's', date: '2026-11-23', status: 'DONE', error: null, startedAt: at })
    expect(a).toMatchObject({ agent: 'ringkas', status: 'ok', title: 'Ringkasan harian 2026-11-23' })
    const b = { ...a, id: 'x', at: '2026-11-24T05:00:00.000Z' }
    expect(sortActivities([a, b]).map((x) => x.id)).toEqual(['x', 'sum:s'])
  })
})

describe('bukti pesan & rujukan legacy', () => {
  it('isi pesan terkirim dari payload, tujuan disamarkan, grup diberi keterangan', () => {
    const base = { id: 'j', conversationId: null, status: 'SENT', lastError: null, createdAt: at }
    const v = fromJob({ ...base, templateKey: 'internal_bali_transport_reminder', target: '628155703072', payload: { text: '*Transport Bali*\nJemput 07:00', media: null }, idempotencyKey: 'internal_bali_transport_reminder:booking-4521:2026-11-25' }, null, 'Pengingat transport Bali H-1', 'conv-vendor')
    expect(v).toMatchObject({ conversationId: 'conv-vendor', bookingRef: '4521', message: { text: '*Transport Bali*\nJemput 07:00', imageUrl: null, to: 'Vendor · ••• 3072' } })
    expect(JSON.stringify(v)).not.toContain('628155703072')
    const g = fromJob({ ...base, templateKey: 'crew_reminder_group', target: 'grup:120363@g.us', payload: { text: 'Besok jemput', media: { url: 'https://x/y.jpg' } }, idempotencyKey: 'crew_reminder_group:88:2026-11-25' }, null, undefined, null)
    expect(g).toMatchObject({ bookingRef: '88', message: { to: 'Grup WhatsApp crew', imageUrl: 'https://x/y.jpg' }, chatNote: 'Dikirim ke grup WhatsApp; grup tidak tampil di Inbox.' })
  })

  it('rujukan booking hanya dari segmen angka', async () => {
    const { bookingRefOf } = await import('./agent-activity')
    expect(bookingRefOf('payment_reminder_balance:123:2026-11-24')).toBe('123')
    expect(bookingRefOf('internal_bali_transport_reminder:addon-9:2026-11-24')).toBeUndefined()
    expect(bookingRefOf('trip_concluded:abc')).toBeUndefined()
    expect(bookingRefOf(null)).toBeUndefined()
  })

  it('balasan bot membawa pesan tamu dan balasan sebagai bukti', () => {
    const a = fromRun({ id: 'r', conversationId: 'c', status: 'REPLIED', inboundText: 'Ijen buka?', replyText: 'Buka 01:00', error: null, startedAt: at }, 'Tom')
    expect(a).toMatchObject({ inbound: 'Ijen buka?', message: { text: 'Buka 01:00', to: 'Tamu · Tom' } })
  })
})
