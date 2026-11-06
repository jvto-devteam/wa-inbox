/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/bot/llm', () => ({ callLLM: vi.fn() }))

import { callLLM } from '@/lib/bot/llm'
import type { ConversationReview } from '@/lib/daily-summary/payload-schema'
import {
  buildCrewNotePrompt,
  crewNoteInput,
  crewNoteIsEmpty,
  emptyCrewNote,
  generateCrewNote,
  isNoiseForCrew,
  isUnsafeForCrew,
  scrubMoney,
  parseCrewNote,
} from './crew-note'

const NOW = new Date('2026-11-06T03:00:00Z')

const review: ConversationReview = {
  status: 'perlu_tindakan',
  alasan: 'x',
  jenisKontak: 'tamu_existing',
  topik: 'Jemputan',
  pertanyaan: [
    { teks: 'Apakah Air Terjun Sewu butuh permit drone?', terjawab: false },
    { teks: 'Apakah paket termasuk sarapan?', terjawab: true },
    { teks: 'Berapa harga transfer Gilimanuk ke Ubud?', terjawab: false },
  ],
  poinPenting: [
    { teks: 'Jemput tour 20 Nov tetap jam 11.00 (booking: 11:00), bukan jam 08.00.', jenis: 'jemput' },
    { teks: 'Pembayaran lunas Rp8.100.000 via transfer bank.', jenis: 'bayar' },
    { teks: 'Hotel kotor, minta pindah kamar.', jenis: 'komplain' },
    { teks: 'Minta viewpoint yang lebih sepi. Hubungi +62 812 3456 7890', jenis: 'kebutuhan' },
    { teks: 'Tamu menimbang permit drone harian (IDR 2jt).', jenis: 'keputusan' },
  ],
  janjiTim: [
    { teks: 'Mengecek konfigurasi tempat tidur dengan tim.', terpenuhi: true },
    { teks: 'Mengirimkan tanda terima pembayaran.', terpenuhi: false },
  ],
  profil: [
    { label: 'banyak_revisi', messageId: 'm1' },
    { label: 'sensitif_harga', messageId: 'm2' },
    { label: 'klook_ota', messageId: 'm3' },
    { label: 'pasangan', messageId: 'm4' },
  ],
  statusAgen: '',
  langkahBerikut: '',
}

beforeEach(() => vi.mocked(callLLM).mockReset())

describe('isUnsafeForCrew', () => {
  it.each([
    'Pembayaran lunas Rp8.100.000',
    'Tambahan Rp650.000 untuk satu malam',
    'Kompensasi IDR810.000',
    'Sisa dibayar tunai ke driver',
    'IDR 2jt untuk permit',
    'Biaya tambahan 500rb',
    'Hubungi [nomor]',
    'Kirim ke [email]',
    'DP sudah masuk',
    'Harga paket naik',
  ])('menolak %s', (line) => expect(isUnsafeForCrew(line)).toBe(true))

  it.each([
    'Jemput tour 20 Nov jam 11:00, bukan 08:00.',
    'Takut ketinggian di Tumpak Sewu. Jangan dipaksa turun.',
    'Tiba di Juanda 16:40, jemput 17:30.',
    'Jemputan bandara 19 Nov tidak termasuk paket.',
  ])('meloloskan %s', (line) => expect(isUnsafeForCrew(line)).toBe(false))
})

describe('scrubMoney', () => {
  it('membuang nominal dan kurung yang memuatnya, merapikan spasi', () => {
    expect(scrubMoney('Permit drone harian (biaya IDR 2jt); putuskan di hari H.')).toBe('Permit drone harian; putuskan di hari H.')
    expect(scrubMoney('Single supplement Rp700.000 untuk 2 kamar')).toBe('Single supplement untuk 2 kamar')
    expect(scrubMoney('Tiba 16:40, jemput 17:30')).toBe('Tiba 16:40, jemput 17:30')
  })
})

describe('isNoiseForCrew', () => {
  it.each(['Asal negara dan bahasa tidak disebutkan.', 'Jam jemput belum diketahui.', 'Tidak ada informasi tambahan.'])('membuang %s', (line) =>
    expect(isNoiseForCrew(line)).toBe(true)
  )
  it.each(['Pasangan, 2 orang.', 'Jemput jam 07.00 di hotel.', 'Tamu tidak makan daging.'])('meloloskan %s', (line) => expect(isNoiseForCrew(line)).toBe(false))

  it('parseCrewNote ikut membuangnya', () => {
    const note = parseCrewNote(JSON.stringify({ siapa: ['Pasangan.', 'Asal negara tidak disebutkan.'] }), null, NOW)!
    expect(note.siapa).toEqual(['Pasangan.'])
  })
})

describe('crewNoteInput', () => {
  it('membuang poin bayar dan komplain, label komersial, dan baris yang menyebut uang', () => {
    const input = crewNoteInput(review, '- Paket: 3D2N', null, null)!
    const texts = input.poin.map((p) => p.teks)
    // Nominal dalam kalimat yang selebihnya berguna dibuang, bukan seluruh kalimatnya.
    expect(texts).toEqual([
      'Jemput tour 20 Nov tetap jam 11.00 (booking: 11:00), bukan jam 08.00.',
      'Tamu menimbang permit drone harian.',
    ])
    expect(input.profil).toEqual(['banyak_revisi', 'pasangan'])
  })

  it('menyertakan pertanyaan belum dijawab yang tidak soal uang, dan janji tim tanpa urusan bayar', () => {
    const input = crewNoteInput(review, '- Paket: 3D2N', null, null)!
    expect(input.pertanyaanBelumDijawab).toEqual(['Apakah Air Terjun Sewu butuh permit drone?'])
    expect(input.janjiTim).toEqual([{ teks: 'Mengecek konfigurasi tempat tidur dengan tim.', terpenuhi: true }])
  })

  it('menyensor nama tamu, telepon, dan email', () => {
    const r: ConversationReview = {
      ...review,
      poinPenting: [{ teks: 'Anna Maria minta jemput di lobi. Email anna@mail.com', jenis: 'jemput' }],
      pertanyaan: [],
      janjiTim: [],
      profil: [],
    }
    const input = crewNoteInput(r, '- Paket: x', null, 'Anna Maria')
    // Baris dengan email dibuang seluruhnya; yang lolos tidak memuat nama.
    expect(JSON.stringify(input)).not.toMatch(/Anna|anna@/)
  })

  it('null bila tidak ada yang layak untuk crew (LLM tidak dipanggil)', () => {
    const r: ConversationReview = { ...review, poinPenting: [{ teks: 'Lunas Rp1.000.000', jenis: 'bayar' }], pertanyaan: [], janjiTim: [], profil: [{ label: 'sensitif_harga', messageId: 'm' }] }
    expect(crewNoteInput(r, '- Paket: x', null, null)).toBeNull()
  })

  it('membawa catatan sebelumnya hanya bila tidak kosong', () => {
    const prev = { ...emptyCrewNote(NOW), perubahan: ['Jam jemput 12:00 (sebelumnya 10:00).'] }
    expect(crewNoteInput(review, '- Paket: x', prev, null)!.catatanSebelumnya).toMatchObject({ perubahan: ['Jam jemput 12:00 (sebelumnya 10:00).'] })
    expect(crewNoteInput(review, '- Paket: x', emptyCrewNote(NOW), null)!.catatanSebelumnya).toBeNull()
  })
})

describe('parseCrewNote', () => {
  it('menerima JSON valid (juga dalam code fence) dan mengabaikan kunci asing', () => {
    const raw = '```json\n' + JSON.stringify({ perubahan: ['Jemput 11:00, bukan 08:00.'], asing: ['x'] }) + '\n```'
    const note = parseCrewNote(raw, null, NOW)!
    expect(note.perubahan).toEqual(['Jemput 11:00, bukan 08:00.'])
    expect(note.logistik).toEqual([])
    expect(note.diperbaruiAt).toBe(NOW.toISOString())
  })

  it('membuang baris dengan nominal, kata bayar, telepon, atau email dari keluaran LLM', () => {
    const raw = JSON.stringify({
      permintaan: ['Tamu menimbang permit drone (Rp2jt).', 'Tamu membawa drone kecil.'],
      logistik: ['Sisa dibayar tunai.', 'Hubungi 0812 3456 7890.', 'Kirim ke a@b.com.', '6 kamar: 4 twin dan 2 double.'],
    })
    const note = parseCrewNote(raw, null, NOW)!
    expect(note.permintaan).toEqual(['Tamu membawa drone kecil.'])
    expect(note.logistik).toEqual(['6 kamar: 4 twin dan 2 double.'])
  })

  it('mengganti penanda nama dengan "tamu" dan menyensor nama kontak', () => {
    const note = parseCrewNote(JSON.stringify({ kebutuhan: ['Budi takut ketinggian.'] }), 'Budi', NOW)!
    expect(note.kebutuhan).toEqual(['tamu takut ketinggian.'])
  })

  it('membatasi jumlah baris per bagian dan membuang baris dobel dan nomor transkrip', () => {
    const many = Array.from({ length: 10 }, (_, i) => `Hal ${i} #${i + 1}`)
    const note = parseCrewNote(JSON.stringify({ siapa: ['Pasangan.', 'Pasangan.', ...many] }), null, NOW)!
    expect(note.siapa).toHaveLength(2)
    expect(note.siapa[0]).toBe('Pasangan.')
    expect(note.siapa[1]).toBe('Hal 0')
  })

  it('null untuk JSON rusak atau bukan objek; bagian bukan array jadi kosong', () => {
    expect(parseCrewNote('bukan json', null, NOW)).toBeNull()
    expect(parseCrewNote('[]', null, NOW)).toBeNull()
    expect(crewNoteIsEmpty(parseCrewNote(JSON.stringify({ siapa: 'Pasangan' }), null, NOW)!)).toBe(true)
  })
})

describe('generateCrewNote', () => {
  const base = { review, bookingContext: '- Paket: 3D2N', previous: null, contactName: null, model: 'm', now: NOW }

  it('memanggil LLM dengan masukan yang sudah disaring, tanpa transkrip', async () => {
    vi.mocked(callLLM).mockResolvedValue(JSON.stringify({ perubahan: ['Jemput 11:00, bukan 08:00.'] }))
    const note = await generateCrewNote(base)
    expect(note?.perubahan).toEqual(['Jemput 11:00, bukan 08:00.'])
    const prompt = vi.mocked(callLLM).mock.calls[0][0]
    expect(prompt).toBe(buildCrewNotePrompt(crewNoteInput(review, '- Paket: 3D2N', null, null)!))
    expect(prompt).not.toMatch(/8\.100\.000|Hotel kotor|sensitif_harga|klook_ota/)
  })

  it('catatan kosong tanpa memanggil LLM bila tidak ada yang layak', async () => {
    const r: ConversationReview = { ...review, poinPenting: [], pertanyaan: [], janjiTim: [], profil: [] }
    const note = await generateCrewNote({ ...base, review: r })
    expect(note && crewNoteIsEmpty(note)).toBe(true)
    expect(callLLM).not.toHaveBeenCalled()
  })

  it('null bila LLM gagal atau keluaran rusak (tidak melempar)', async () => {
    vi.mocked(callLLM).mockRejectedValueOnce(new Error('timeout'))
    expect(await generateCrewNote(base)).toBeNull()
    vi.mocked(callLLM).mockResolvedValueOnce('bukan json')
    expect(await generateCrewNote(base)).toBeNull()
  })
})
