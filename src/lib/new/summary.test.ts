import { describe, expect, it } from 'vitest'
import { sampleSummary } from '@/components/new/__fixtures__/summary'
import { chatHref, summaryDay } from './summary'

describe('summaryDay', () => {
  it('poin per jenis (komplain dulu), satu review per percakapan, janji belum ditepati dihitung', () => {
    const D = summaryDay(sampleSummary())!
    expect(D.points.map((p) => [p.kind, p.name, p.text])).toEqual([
      ['komplain', 'Lukas B.', 'Sopir telat 1 jam di hotel'],
      ['jemput', 'Emma R.', 'Jemput di Ketapang jam 06.00'],
      [null, 'Emma R.', 'Poin lama tanpa jenis'],
    ])
    expect(D.points[0]).toMatchObject({ conversationId: 'c2', messageId: 'm7' })
    expect(D.unkept).toBe(1)
  })

  it('status per percakapan: item antrean live menang atas review hari itu; tanpa review tidak tampil', () => {
    const D = summaryDay(sampleSummary())!
    // Emma ada di payload.conversations (aktif hari itu); Lukas hanya kandidat belum dibalas (menggantung)
    expect(D.chats.map((c) => [c.name, c.open, c.active])).toEqual([['Emma R.', true, true], ['Lukas B.', true, false]])
    const lukas = D.chats.find((c) => c.conversationId === 'c2')!
    expect(lukas.lines).toEqual(['❓ Kapan sopir datang?'])
    expect(lukas).toMatchObject({ saran: 'Minta maaf dan tawarkan jemput ulang', item: null })
    const emma = D.chats.find((c) => c.conversationId === 'c1')!
    expect(emma.lines).toEqual(['⏳ Kirim invoice'])
    // langkahBerikut kosong → rekomendasi follow-up lead
    expect(emma).toMatchObject({ saran: 'Kirim invoice hari ini', item: { id: 'i1', state: 'OPEN' } })

    const res = sampleSummary()
    res.items = { c1: { ...res.items.c1, state: 'DONE' } }
    // percakapan yang sudah selesai tidak membawa saran lama
    expect(summaryDay(res)!.chats.find((c) => c.conversationId === 'c1')!).toMatchObject({ open: false, saran: null })
  })

  it('tanpa ringkasan = null; payload rusak = tanpa poin', () => {
    expect(summaryDay({ dates: [], summary: null, items: {} })).toBeNull()
    const res = sampleSummary()
    res.summary = { ...res.summary!, payload: null, error: 'Format ringkasan tersimpan tidak dikenali. Buat ulang ringkasan ini.' }
    expect(summaryDay(res)).toMatchObject({ points: [], chats: [], error: expect.stringContaining('Buat ulang') })
  })

  it('chatHref menyorot pesan bila ada', () => {
    expect(chatHref('c1')).toBe('/inbox?conversation=c1')
    expect(chatHref('c1', 'm7')).toBe('/inbox?conversation=c1&message=m7')
  })
})
