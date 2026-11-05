/**
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest'
import type { DailySummaryPayload } from '@/lib/daily-summary/payload-schema'
import { buildSummaryDigest, redactText } from './digest'

const review = {
  status: 'perlu_tindakan' as const,
  alasan: 'Anna Maria belum dijawab soal jemput',
  jenisKontak: 'calon_tamu' as const,
  topik: 'Ijen 3D2N untuk Anna',
  pertanyaan: [{ teks: 'Apakah Anna bisa naik Ijen dengan asma?', terjawab: false, messageId: 'm1' }],
  poinPenting: [
    { teks: 'Hubungi +62 812-3456-7890 atau anna.maria@example.com', jenis: 'kebutuhan' as const, messageId: 'm2' },
  ],
  janjiTim: [{ teks: 'Tim akan cek kuota Ijen untuk Maria', terpenuhi: false, messageId: 'm3' }],
  profil: [{ label: 'pasangan' as const, messageId: 'm4' }],
  statusAgen: 'menunggu',
  langkahBerikut: 'Kirim info skrining ke Anna',
}

function payload(): DailySummaryPayload {
  return {
    version: 1,
    date: '2026-11-04',
    windowStart: '2026-11-03T17:00:00.000Z',
    windowEnd: '2026-11-04T17:00:00.000Z',
    generatedAt: '2026-11-04T17:05:00.000Z',
    excludedIndonesian: true,
    thresholds: { unrepliedMinMs: 1, dormantMinMs: 1, lookbackMs: 1 },
    counts: { activeConversations: 2, inbound: 5, outbound: 3, newConversations: 1, reviewed: 2, reviewFailed: 0 },
    filteredOut: { unreplied: 1, dormant: 0, unrepliedIds: ['c9'] },
    unreplied: [
      {
        conversationId: 'c1',
        contactName: 'Anna Maria',
        pipelineStage: 'nego',
        lastMessageAt: '2026-11-04T10:00:00.000Z',
        lastMessageId: 'm9',
        waitingMs: 5_400_000,
        snippet: 'Hi this is Anna, my number is +628123456789',
        review,
      },
    ],
    dormant: [
      {
        conversationId: 'c2',
        contactName: 'Budi',
        pipelineStage: 'new',
        lastMessageAt: '2026-11-02T10:00:00.000Z',
        silentMs: 2 * 3_600_000,
        snippet: 'Budi here',
        review: null,
      },
    ],
    newLeads: [
      {
        conversationId: 'c1',
        contactName: 'Anna Maria',
        pipelineStage: 'nego',
        createdAt: '2026-11-04T09:00:00.000Z',
        tripBrief: { destination: 'Ijen', pax: 2 },
        review,
      },
    ],
    handoffs: [
      { runId: 'r1', conversationId: 'c1', contactName: 'Anna Maria', at: '2026-11-04T09:30:00.000Z', inboundText: 'I want a human, Anna', stillWaiting: true },
    ],
    gaps: {
      newCount: 1,
      openTotal: 3,
      byReason: [{ key: 'no_fact', count: 1 }],
      byTopic: [{ key: 'ijen', count: 1 }],
      items: [{ id: 'g1', conversationId: 'c1', messageId: 'm1', contactName: 'Anna Maria', topic: 'ijen', reason: 'no_fact', messageText: 'Anna asks about asthma' }],
    },
    conversations: [
      { conversationId: 'c1', contactName: 'Anna Maria', pipelineStage: 'nego', inbound: 4, outbound: 2, review },
      { conversationId: 'c2', contactName: 'Budi', pipelineStage: 'new', inbound: 1, outbound: 1, review: null },
    ],
  }
}

describe('redactText', () => {
  it('replaces the contact name, its parts, phones and emails', () => {
    expect(redactText('Anna Maria (Anna) wrote from +62 812-3456-7890 / a.b@x.io', 'Anna Maria')).toBe(
      '[tamu] ([tamu]) wrote from [nomor] / [email]'
    )
  })

  it('keeps money amounts, dates and times, but still catches local and international numbers', () => {
    expect(redactText('DP IDR 2,040,000 lunas, sisa Rp 9.310.000 dan Rp1.500.000; USD 161,05')).toBe(
      'DP IDR 2,040,000 lunas, sisa Rp 9.310.000 dan Rp1.500.000; USD 161,05'
    )
    expect(redactText('2 pax: Rp 2.800.000/orang, tiba 2026-11-10 jam 15.40')).toBe(
      '2 pax: Rp 2.800.000/orang, tiba 2026-11-10 jam 15.40'
    )
    expect(redactText('WA 0812-3456-7890 atau 6281234567890 atau +33 6 12 34 56 78')).toBe(
      'WA [nomor] atau [nomor] atau [nomor]'
    )
  })

  it('does not touch words that only contain the name', () => {
    expect(redactText('Annapurna trip', 'Anna')).toBe('Annapurna trip')
  })

  it('keeps short name parts that would over-match', () => {
    expect(redactText('Bo is coming to Bromo', 'Bo Li')).toBe('Bo is coming to Bromo')
  })
})

describe('buildSummaryDigest', () => {
  const digest = buildSummaryDigest({ date: '2026-11-04', status: 'DONE', payload: payload() }, new Map([['c1', 'JVTO-3890']]))

  it('contains no contact name, phone, email, snippet or raw message text anywhere', () => {
    const text = JSON.stringify(digest)
    for (const leaked of ['Anna', 'Maria', 'Budi', '812', '628123456789', 'example.com', 'snippet', 'messageText', 'inboundText', 'messageId', 'contactName']) {
      expect(text).not.toContain(leaked)
    }
  })

  it('keeps the patterns the Operator needs', () => {
    expect(digest).not.toBeNull()
    const c1 = digest!.conversations[0]
    expect(c1.bookingRef).toBe('JVTO-3890')
    expect(c1.review?.pertanyaan).toEqual([{ teks: 'Apakah [tamu] bisa naik Ijen dengan asma?', terjawab: false }])
    expect(c1.review?.janjiTim).toEqual([{ teks: 'Tim akan cek kuota Ijen untuk [tamu]', terpenuhi: false }])
    expect(c1.review?.poinPenting).toEqual([{ jenis: 'kebutuhan', teks: 'Hubungi [nomor] atau [email]' }])
    expect(c1.review?.profil).toEqual(['pasangan'])
    expect(digest!.conversations[1]).toMatchObject({ conversationId: 'c2', bookingRef: null, review: null })
    expect(digest!.unreplied).toEqual([{ conversationId: 'c1', pipelineStage: 'nego', waitingMinutes: 90 }])
    expect(digest!.dormant).toEqual([{ conversationId: 'c2', pipelineStage: 'new', silentHours: 2 }])
    expect(digest!.handoffs).toEqual({ count: 1, stillWaiting: 1 })
    expect(digest!.gaps).toEqual({ newCount: 1, openTotal: 3, byReason: [{ key: 'no_fact', count: 1 }], byTopic: [{ key: 'ijen', count: 1 }] })
    expect(digest!.filteredOut).toEqual({ unreplied: 1, dormant: 0 })
  })

  it('returns null for a payload that does not match the schema', () => {
    expect(buildSummaryDigest({ date: '2026-11-04', status: 'DONE', payload: { version: 2 } }, new Map())).toBeNull()
  })
})
