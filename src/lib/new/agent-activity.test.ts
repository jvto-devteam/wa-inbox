import { describe, expect, it } from 'vitest'
import { TEMPLATE_AGENT, fromEvent, fromJob, fromRun, fromSummary, sortActivities } from './agent-activity'
import { SYSTEM_TEMPLATE_SEEDS } from '@/lib/system-templates/seed-data'

const at = new Date('2026-11-24T03:00:00Z')

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
