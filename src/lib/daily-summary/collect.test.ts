import { describe, expect, it } from 'vitest'
import { buildTranscript, classifyConversation, messageSnippet, summarizeTripBrief, type ConversationFacts, type TranscriptMessage } from './collect'
import { jakartaDayRange } from './time'

const { start, end } = jakartaDayRange('2026-09-21')
const HOUR = 60 * 60 * 1000
const before = (ms: number) => new Date(end.getTime() - ms)

function msg(direction: 'INBOUND' | 'OUTBOUND', at: Date, content: string | null = 'halo', type = 'text'): TranscriptMessage {
  return { id: `m-${direction}-${at.getTime()}`, direction, sentBy: direction === 'INBOUND' ? 'CUSTOMER' : 'AGENT', type, content, createdAt: at }
}

function facts(messages: TranscriptMessage[], overrides: Partial<ConversationFacts> = {}): ConversationFacts {
  return {
    conversationId: 'c1',
    contactName: 'Anna',
    pipelineStage: 'new',
    createdAt: new Date('2026-08-01T00:00:00Z'),
    tripBrief: null,
    messages,
    inboundToday: 0,
    outboundToday: 0,
    ...overrides,
  }
}

describe('classifyConversation — belum dibalas', () => {
  it('pesan pelanggan ≥ 1 jam tanpa balasan masuk kandidat', () => {
    const c = classifyConversation(facts([msg('OUTBOUND', before(5 * HOUR)), msg('INBOUND', before(HOUR))]), start, end)
    expect(c.unreplied?.waitingMs).toBe(HOUR)
    expect(c.dormant).toBeNull()
  })

  it('pesan pelanggan yang baru 59 menit belum dicap', () => {
    const c = classifyConversation(facts([msg('INBOUND', before(59 * 60 * 1000))]), start, end)
    expect(c.unreplied).toBeNull()
  })

  it('lebih dari 14 hari tidak lagi dihitung', () => {
    const c = classifyConversation(facts([msg('INBOUND', before(15 * 24 * HOUR))]), start, end)
    expect(c.unreplied).toBeNull()
  })

  it('pesan sesudah akhir hari tidak ikut -- penilaian memakai akhir hari, bukan jam dinding', () => {
    // collectDay hanya memuat pesan < end; di sini dipastikan hitungannya relatif ke `end`.
    const c = classifyConversation(facts([msg('INBOUND', before(2 * HOUR))]), start, end)
    expect(c.unreplied?.waitingMs).toBe(2 * HOUR)
  })
})

describe('classifyConversation — pelanggan diam', () => {
  it('balasan kita ≥ 48 jam tanpa jawaban pada tahap new/nego masuk kandidat', () => {
    const c = classifyConversation(facts([msg('INBOUND', before(60 * HOUR)), msg('OUTBOUND', before(48 * HOUR))], { pipelineStage: 'nego' }), start, end)
    expect(c.dormant?.silentMs).toBe(48 * HOUR)
  })

  it('belum 48 jam belum dicap', () => {
    const c = classifyConversation(facts([msg('OUTBOUND', before(47 * HOUR))]), start, end)
    expect(c.dormant).toBeNull()
  })

  it.each(['booked', 'lunas', 'selesai'])('tahap %s bukan lead yang dikejar', (stage) => {
    const c = classifyConversation(facts([msg('OUTBOUND', before(72 * HOUR))], { pipelineStage: stage }), start, end)
    expect(c.dormant).toBeNull()
  })
})

describe('classifyConversation — aktif & lead baru', () => {
  it('aktif bila ada pesan hari itu; lead baru bila percakapan dibuat hari itu', () => {
    const c = classifyConversation(
      facts([msg('INBOUND', before(3 * HOUR))], { inboundToday: 1, createdAt: new Date(start.getTime() + HOUR) }),
      start,
      end
    )
    expect(c.activeToday).toBe(true)
    expect(c.isNewLead).toBe(true)
  })

  it('percakapan yang dibuat kemarin bukan lead baru', () => {
    const c = classifyConversation(facts([msg('INBOUND', before(3 * HOUR))], { createdAt: new Date(start.getTime() - 1) }), start, end)
    expect(c.isNewLead).toBe(false)
  })
})

describe('buildTranscript & messageSnippet', () => {
  it('memakai peran dan waktu WIB, media jadi [tipe], tanpa nomor telepon', () => {
    const transcript = buildTranscript([
      msg('INBOUND', new Date('2026-09-21T02:05:00Z'), 'Ijen tanggal 3 Oktober untuk 2 orang?'),
      msg('OUTBOUND', new Date('2026-09-21T02:10:00Z'), null, 'image'),
    ])
    expect(transcript).toBe('[21/09 09.05] Pelanggan: Ijen tanggal 3 Oktober untuk 2 orang?\n[21/09 09.10] Agen: [image]')
  })

  it('memotong pesan panjang', () => {
    expect(buildTranscript([msg('INBOUND', start, 'a'.repeat(1500))]).length).toBeLessThan(1100)
    expect(messageSnippet(msg('INBOUND', start, 'b'.repeat(500))).length).toBe(160)
  })
})

describe('summarizeTripBrief', () => {
  it('hanya mengambil field yang ditampilkan, dengan tipe yang benar', () => {
    expect(summarizeTripBrief({ destination: 'ijen', pax: 2, dateRange: ' ', notes: 'x', dayCount: '3' })).toEqual({ destination: 'ijen', pax: 2 })
  })

  it('kosong atau bukan objek → null', () => {
    expect(summarizeTripBrief({ lastTopic: 'price' })).toBeNull()
    expect(summarizeTripBrief(null)).toBeNull()
    expect(summarizeTripBrief(['ijen'])).toBeNull()
  })
})
