/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended'
import type { PrismaClient } from '@prisma/client'

vi.mock('@/lib/db', () => ({ prisma: mockDeep<PrismaClient>() }))
vi.mock('@/lib/daily-summary/review', () => ({ reviewConversation: vi.fn() }))
vi.mock('@/lib/summary-items/sync', () => ({ applyReviewToItem: vi.fn().mockResolvedValue('unchanged') }))
vi.mock('./store', async (orig) => ({ ...(await orig<typeof import('./store')>()), saveChatReview: vi.fn().mockResolvedValue(undefined) }))
vi.mock('./crew-note', async (orig) => ({ ...(await orig<typeof import('./crew-note')>()), generateCrewNote: vi.fn() }))
vi.mock('./schedule-note', async (orig) => ({ ...(await orig<typeof import('./schedule-note')>()), generateScheduleNote: vi.fn() }))
vi.mock('@/lib/booking-note/sync', () => ({ scheduleScheduleNoteSync: vi.fn() }))
vi.mock('./crew-note-sync', async (orig) => ({ ...(await orig<typeof import('./crew-note-sync')>()), scheduleCrewNotePush: vi.fn() }))

import { prisma } from '@/lib/db'
import { reviewConversation } from '@/lib/daily-summary/review'
import { refreshChatReview } from './refresh'
import { saveChatReview } from './store'
import { generateCrewNote, emptyCrewNote } from './crew-note'
import { scheduleCrewNotePush } from './crew-note-sync'
import { generateScheduleNote } from './schedule-note'
import { scheduleScheduleNoteSync } from '@/lib/booking-note/sync'

const db = prisma as unknown as DeepMockProxy<PrismaClient>
const NOW = new Date('2026-10-20T05:00:00Z')
const question = { id: 'm1', direction: 'INBOUND', sentBy: 'CUSTOMER', type: 'text', content: 'ganti kaos jadi L, dan bisa tambah Ijen?', createdAt: new Date('2026-10-20T03:00:00Z') }
const notice = { id: 'n1', direction: 'OUTBOUND', sentBy: 'BOT', type: 'text', content: 'Noted, thank you! Your booking has been updated:', createdAt: new Date('2026-10-20T03:00:10Z') }

beforeEach(() => {
  mockReset(db)
  vi.mocked(reviewConversation).mockReset().mockResolvedValue(null)
  db.settings.findUnique.mockResolvedValue({ ollamaModel: 'm' } as never)
})

function given(ids: string[]) {
  db.message.findMany.mockImplementation((async (a: { where: { OR?: unknown } }) =>
    a.where.OR ? ids.map((id) => ({ id })) : [notice, question]) as never) // kueri transkrip: urut baru -> lama
}

describe('refreshChatReview: automated notices (review Important A)', () => {
  it("question + automated notice -> reasons ['unreplied'] and the notice is labelled in the transcript; botTrace never loaded", async () => {
    given(['n1'])
    await refreshChatReview('c1', NOW)
    const [transcript, reasons] = vi.mocked(reviewConversation).mock.calls[0]
    expect(reasons).toEqual(['unreplied'])
    expect(transcript.text).toContain('Sistem (pesan otomatis): Noted')
    expect(transcript.text).toContain('Pelanggan: ganti kaos')
    const transcriptQuery = db.message.findMany.mock.calls.map((c) => c[0]).find((q) => !(q?.where as { OR?: unknown } | undefined)?.OR)
    expect(transcriptQuery?.select).not.toHaveProperty('botTrace')
  })

  it("a real reply last -> reasons ['active']", async () => {
    given([])
    await refreshChatReview('c1', NOW)
    expect(vi.mocked(reviewConversation).mock.calls[0][1]).toEqual(['active'])
    expect(vi.mocked(reviewConversation).mock.calls[0][0].text).not.toContain('Sistem (pesan otomatis)')
  })
})

describe('refreshChatReview: catatan crew (Guest Brief)', () => {
  const goodReview = {
    status: 'perlu_tindakan', alasan: 'a', jenisKontak: 'tamu_existing', topik: 't', pertanyaan: [], poinPenting: [], janjiTim: [], profil: [], statusAgen: '', langkahBerikut: '',
  } as never
  const booking = { id: 'JVR/012/11/26', package: '3D2N', date: { start_ymd: '2026-11-20', end_ymd: '2026-11-22' } }
  const note = { ...emptyCrewNote(NOW), perubahan: ['Jemput 11:00, bukan 08:00.'] }

  beforeEach(() => {
    delete process.env.CREW_NOTE_ENABLED
    vi.mocked(saveChatReview).mockClear()
    vi.mocked(generateCrewNote).mockReset()
    vi.mocked(scheduleCrewNotePush).mockReset()
    vi.mocked(generateScheduleNote).mockReset().mockResolvedValue(null)
    vi.mocked(reviewConversation).mockResolvedValue(goodReview)
    db.conversation.findUnique.mockResolvedValue({ bookingData: booking, chatReview: null, contact: { name: 'Budi' } } as never)
    given([])
  })

  it('mati secara default: tidak memanggil LLM kedua dan tidak menambah catatanCrew', async () => {
    await refreshChatReview('c1', NOW)
    expect(generateCrewNote).not.toHaveBeenCalled()
    expect(scheduleCrewNotePush).not.toHaveBeenCalled()
    expect(vi.mocked(saveChatReview).mock.calls[0][1]).toEqual(goodReview)
  })

  it('note untuk Schedule: dibuat untuk percakapan ber-booking walau catatan crew mati, disimpan bersama ringkasan', async () => {
    const scheduleNote = { baris: ['1 orang vegan'], diperbaruiAt: NOW.toISOString() }
    vi.mocked(generateScheduleNote).mockResolvedValue(scheduleNote)
    await refreshChatReview('c1', NOW)
    expect(generateScheduleNote).toHaveBeenCalledWith(expect.objectContaining({ booking, contactName: 'Budi', model: 'm', at: NOW }))
    expect(vi.mocked(saveChatReview).mock.calls[0][1]).toMatchObject({ catatanSchedule: scheduleNote })
    expect(generateCrewNote).not.toHaveBeenCalled()
  })

  it('note untuk Schedule dikirim ke bookings.note untuk percakapan uji; percakapan pelanggan sungguhan ditahan selama rollout test', async () => {
    const scheduleNote = { baris: ['1 orang vegan'], diperbaruiAt: NOW.toISOString() }
    vi.mocked(generateScheduleNote).mockResolvedValue(scheduleNote)
    delete process.env.BOOKING_ACTIONS_ROLLOUT
    process.env.BOOKING_ACTIONS_TEST_PHONES = '6282143403501'

    vi.mocked(scheduleScheduleNoteSync).mockClear()
    db.conversation.findUnique.mockResolvedValue({ bookingData: booking, chatReview: null, isTest: false, contact: { name: 'Budi', phone: '6281234567890' } } as never)
    await refreshChatReview('c1', NOW)
    expect(scheduleScheduleNoteSync).not.toHaveBeenCalled()

    db.conversation.findUnique.mockResolvedValue({ bookingData: booking, chatReview: null, isTest: false, contact: { name: 'Budi', phone: '082143403501' } } as never)
    await refreshChatReview('c1', NOW)
    expect(scheduleScheduleNoteSync).toHaveBeenCalledWith(booking, ['1 orang vegan'], NOW)

    process.env.BOOKING_ACTIONS_ROLLOUT = 'all'
    vi.mocked(scheduleScheduleNoteSync).mockClear()
    db.conversation.findUnique.mockResolvedValue({ bookingData: booking, chatReview: null, isTest: false, contact: { name: 'Budi', phone: '6281234567890' } } as never)
    await refreshChatReview('c1', NOW)
    expect(scheduleScheduleNoteSync).toHaveBeenCalledTimes(1)
    delete process.env.BOOKING_ACTIONS_ROLLOUT
    delete process.env.BOOKING_ACTIONS_TEST_PHONES
  })

  it('SCHEDULE_NOTE_ROLLOUT=all membuka note ke semua percakapan ber-booking', async () => {
    vi.mocked(generateScheduleNote).mockResolvedValue({ baris: ['1 orang vegan'], diperbaruiAt: NOW.toISOString() })
    process.env.SCHEDULE_NOTE_ROLLOUT = 'all'
    vi.mocked(scheduleScheduleNoteSync).mockClear()
    db.conversation.findUnique.mockResolvedValue({ bookingData: booking, chatReview: null, isTest: false, contact: { name: 'Budi', phone: '6281234567890' } } as never)
    await refreshChatReview('c1', NOW)
    expect(scheduleScheduleNoteSync).toHaveBeenCalledTimes(1)
    delete process.env.SCHEDULE_NOTE_ROLLOUT
  })

  it('note untuk Schedule gagal: note sebelumnya dipertahankan; tanpa booking atau mitra: tidak dibuat', async () => {
    const previous = { baris: ['2 tamu vegan'], diperbaruiAt: '2026-11-12T05:00:00.000Z' }
    db.conversation.findUnique.mockResolvedValue({ bookingData: booking, chatReview: { catatanSchedule: previous }, contact: { name: 'Budi' } } as never)
    await refreshChatReview('c1', NOW)
    expect(vi.mocked(saveChatReview).mock.calls[0][1]).toMatchObject({ catatanSchedule: previous })

    vi.mocked(generateScheduleNote).mockClear()
    db.conversation.findUnique.mockResolvedValue({ bookingData: null, chatReview: null, contact: { name: 'Budi' } } as never)
    await refreshChatReview('c1', NOW)
    expect(generateScheduleNote).not.toHaveBeenCalled()
  })

  it('menyala: menyimpan catatanCrew bersama ringkasan untuk percakapan ber-booking', async () => {
    process.env.CREW_NOTE_ENABLED = '1'
    vi.mocked(generateCrewNote).mockResolvedValue(note)
    await refreshChatReview('c1', NOW)
    expect(generateCrewNote).toHaveBeenCalledWith(expect.objectContaining({ contactName: 'Budi', previous: null, model: 'm' }))
    expect(vi.mocked(saveChatReview).mock.calls[0][1]).toMatchObject({ catatanCrew: note })
    // Catatan baru dikirim ke backoffice dengan nomor booking dari bookingData.
    expect(scheduleCrewNotePush).toHaveBeenCalledWith('JVR/012/11/26', note)
  })

  it('tanpa booking: tidak ada catatan crew', async () => {
    process.env.CREW_NOTE_ENABLED = '1'
    db.conversation.findUnique.mockResolvedValue({ bookingData: null, chatReview: null, contact: { name: 'Budi' } } as never)
    await refreshChatReview('c1', NOW)
    expect(generateCrewNote).not.toHaveBeenCalled()
  })

  it('mitra/lainnya: tidak ada catatan crew', async () => {
    process.env.CREW_NOTE_ENABLED = '1'
    vi.mocked(reviewConversation).mockResolvedValue({ ...(goodReview as object), jenisKontak: 'mitra' } as never)
    await refreshChatReview('c1', NOW)
    expect(generateCrewNote).not.toHaveBeenCalled()
  })

  it('LLM catatan gagal: catatan sebelumnya dipertahankan, ringkasan tetap tersimpan', async () => {
    process.env.CREW_NOTE_ENABLED = '1'
    db.conversation.findUnique.mockResolvedValue({ bookingData: booking, chatReview: { catatanCrew: note }, contact: { name: null } } as never)
    vi.mocked(generateCrewNote).mockResolvedValue(null)
    await expect(refreshChatReview('c1', NOW)).resolves.toEqual({ status: 'ok' })
    expect(vi.mocked(saveChatReview).mock.calls[0][1]).toMatchObject({ catatanCrew: note })
    // Yang dipertahankan karena LLM gagal bukan catatan baru: tidak dikirim ulang.
    expect(scheduleCrewNotePush).not.toHaveBeenCalled()
  })
})
