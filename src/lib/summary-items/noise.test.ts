import { describe, expect, it } from 'vitest'
import { isNoiseMessage } from './noise'

const text = (content: string | null, type = 'text') => ({ type, content })

describe('isNoiseMessage', () => {
  it.each([
    'ok', 'Ok.', 'oke kak', 'okkk', 'OK thanks', 'thanks', 'Thank you!', 'thank you very much', 'thanks a lot',
    'noted', 'Noted, thanks', 'terima kasih', 'Terima kasih banyak kak 🙏', 'makasih ya', 'siap kak', 'sip',
    'tq', 'baik pak', '👍', '🙏🏻', '👍👍', '❤️', '😊🙏', 'matur nuwun',
  ])('penutup murni: %s', (content) => {
    expect(isNoiseMessage(text(content))).toBe(true)
  })

  it.each([
    'ok?', 'thanks, how much is Ijen?', 'ok kak, ditunggu ya', 'harga Ijen berapa', 'yes', 'ya', 'kak', 'halo',
    'ok I will transfer tomorrow', 'thanks, can you send the itinerary', 'great see you then', '1', '??',
    'ok ok ok thanks thanks thanks kak', // lebih dari 6 kata
  ])('bukan penutup: %s', (content) => {
    expect(isNoiseMessage(text(content))).toBe(false)
  })

  it('reaksi selalu penutup, apa pun isinya', () => {
    expect(isNoiseMessage(text('😂', 'reaction'))).toBe(true)
    expect(isNoiseMessage(text(null, 'reaction'))).toBe(true)
  })

  it('sesudah pertanyaan agen: "ok"/"siap"/"baik" adalah jawaban, terima kasih tetap penutup', () => {
    const q = { afterAgentQuestion: true }
    for (const content of ['ok', 'oke kak', 'siap', 'baik pak', 'okkk']) expect(isNoiseMessage(text(content), q)).toBe(false)
    for (const content of ['thanks', 'terima kasih kak', 'ok thanks', 'noted']) expect(isNoiseMessage(text(content), q)).toBe(true)
    // Tanpa pertanyaan agen: tetap penutup.
    expect(isNoiseMessage(text('oke kak'), { afterAgentQuestion: false })).toBe(true)
  })

  it('reaksi (bentuk produksi: content null) dan emoji saja tetap penutup, juga sesudah pertanyaan agen', () => {
    const q = { afterAgentQuestion: true }
    expect(isNoiseMessage(text(null, 'reaction'), q)).toBe(true)
    expect(isNoiseMessage(text('👍', 'reaction'), q)).toBe(true)
    for (const content of ['👍', '🙏🏻', '👍👍']) expect(isNoiseMessage(text(content), q)).toBe(true)
  })

  it('pesan tanpa teks (gambar, dokumen, voice) bukan penutup: bisa bukti transfer', () => {
    expect(isNoiseMessage(text(null, 'image'))).toBe(false)
    expect(isNoiseMessage(text('   ', 'document'))).toBe(false)
  })
})
