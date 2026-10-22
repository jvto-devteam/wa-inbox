/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/bot/llm', () => ({ callLLM: vi.fn() }))

import { callLLM } from '@/lib/bot/llm'
import { normalizePoint, normalizePromise, normalizeQuestion, unkeptPromises } from './payload-schema'
import { buildReviewPrompt, parseReview, resolvePesan, reviewConversation, REVIEW_SYSTEM_PROMPT } from './review'

const valid = {
  status: 'perlu_tindakan',
  alasan: 'Pelanggan menanyakan harga dan belum dijawab.',
  jenisKontak: 'calon_tamu',
  topik: 'Paket Ijen',
  pertanyaan: ['Berapa harga untuk 2 orang?'],
  poinPenting: ['3 Oktober', '2 orang'],
  statusAgen: 'Belum ada balasan.',
  langkahBerikut: 'Kirim harga paket Ijen 2 orang.',
}

beforeEach(() => {
  vi.mocked(callLLM).mockReset()
})

describe('parseReview', () => {
  it('menerima JSON valid, juga yang dibungkus code fence', () => {
    // Ringkasan tanpa `janjiTim` (bentuk lama) tetap lolos dan terbaca sebagai daftar kosong.
    expect(parseReview(JSON.stringify(valid))).toEqual({ ...valid, janjiTim: [], profil: [] })
    expect(parseReview('```json\n' + JSON.stringify(valid) + '\n```')?.status).toBe('perlu_tindakan')
  })

  it.each([
    ['bukan JSON', 'Ringkasan: pelanggan tanya harga'],
    ['status di luar enum', JSON.stringify({ ...valid, status: 'urgent' })],
    ['field hilang', JSON.stringify({ status: 'selesai' })],
  ])('menolak %s', (_label, raw) => {
    expect(parseReview(raw)).toBeNull()
  })

  it('menerima pertanyaan berbentuk objek dan string polos, membuang yang teksnya kosong', () => {
    const raw = { ...valid, pertanyaan: [{ teks: '  Harga? ', terjawab: true }, 'Jam jemput?', { teks: '   ', terjawab: false }] }
    expect(parseReview(JSON.stringify(raw))?.pertanyaan).toEqual([{ teks: 'Harga?', terjawab: true }, 'Jam jemput?'])
  })

  describe('toleransi bentuk pertanyaan', () => {
    const parseQ = (pertanyaan: unknown[]) => parseReview(JSON.stringify({ ...valid, pertanyaan }))?.pertanyaan

    it('terjawab berupa string "true"/"false" dijadikan boolean', () => {
      expect(parseQ([{ teks: 'A?', terjawab: 'true' }, { teks: 'B?', terjawab: 'false' }])).toEqual([
        { teks: 'A?', terjawab: true },
        { teks: 'B?', terjawab: false },
      ])
    })

    it('objek tanpa terjawab diturunkan jadi string polos', () => {
      expect(parseQ([{ teks: 'Harga?' }])).toEqual(['Harga?'])
    })

    it('terjawab null atau tidak valid diturunkan jadi string polos', () => {
      expect(parseQ([{ teks: 'A?', terjawab: null }, { teks: 'B?', terjawab: 'mungkin' }, { teks: 'C?', terjawab: 1 }])).toEqual(['A?', 'B?', 'C?'])
    })

    it('teks di kunci "pertanyaan" dipakai sebagai cadangan, jadi string polos', () => {
      expect(parseQ([{ pertanyaan: 'Harga?', terjawab: false }])).toEqual(['Harga?'])
    })

    it('item selain string/objek bermakna dibuang, ringkasan tetap lolos', () => {
      expect(parseQ(['Jam?', 42, null, [], {}, { teks: 5 }, { teks: 'Ok?', terjawab: true }])).toEqual(['Jam?', { teks: 'Ok?', terjawab: true }])
    })

    it('teks hasil penurunan tetap dipotong dan yang kosong dibuang', () => {
      expect(parseQ([{ teks: '   ' }, { teks: 'x'.repeat(400) }])).toEqual([`${'x'.repeat(299)}…`])
    })
  })

  it('membatasi array ke 5 item', () => {
    const many = { ...valid, pertanyaan: ['1', '2', '3', '4', '5', '6', '7'] }
    expect(parseReview(JSON.stringify(many))?.pertanyaan).toHaveLength(5)
  })
})

describe('reviewConversation', () => {
  it('memakai model yang diberikan dan timeout panjang', async () => {
    vi.mocked(callLLM).mockResolvedValue(JSON.stringify(valid))
    await reviewConversation({ text: '#1 [21/09 09.05] Pelanggan: halo', ids: ['m1'] }, ['unreplied'], 'gemma4:31b-cloud')
    const [, opts] = vi.mocked(callLLM).mock.calls[0]
    expect(opts).toMatchObject({ model: 'gemma4:31b-cloud', timeoutMs: 60_000 })
  })

  it('timeout atau error → null, tidak melempar', async () => {
    vi.mocked(callLLM).mockImplementation(async () => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError')
    })
    const review = await reviewConversation({ text: 'x', ids: [] }, ['active'], undefined)
    expect(review).toBeNull()
  })

  it('output rusak → null', async () => {
    vi.mocked(callLLM).mockResolvedValue('maaf, saya tidak bisa')
    await expect(reviewConversation({ text: 'x', ids: [] }, ['active'], undefined)).resolves.toBeNull()
  })
})

describe('buildReviewPrompt', () => {
  it('menyebut alasan kandidat dan hanya memuat transkrip yang diberikan', () => {
    const prompt = buildReviewPrompt('[21/09 09.05] Pelanggan: ok thanks', ['dormant', 'active'])
    expect(prompt).toContain('pelanggan belum menjawab selama beberapa hari')
    expect(prompt).toContain('Pelanggan: ok thanks')
    expect(prompt).not.toMatch(/\+?62\d{8,}/)
  })
})

describe('pertanyaan per butir', () => {
  it('normalizeQuestion: string lama → terjawab null', () => {
    expect(normalizeQuestion('Harga?')).toEqual({ teks: 'Harga?', terjawab: null, messageId: null })
    expect(normalizeQuestion({ teks: 'Harga?', terjawab: false })).toEqual({ teks: 'Harga?', terjawab: false, messageId: null })
    expect(normalizeQuestion({ teks: 'Harga?', terjawab: true, messageId: 'm3' })).toEqual({ teks: 'Harga?', terjawab: true, messageId: 'm3' })
  })

  it('prompt meminta bentuk objek dengan terjawab', () => {
    expect(REVIEW_SYSTEM_PROMPT).toContain('"pertanyaan":[{"teks":"...","terjawab":true|false,"pesan":3}]')
    expect(REVIEW_SYSTEM_PROMPT).toContain('"poinPenting":[{"teks":"...","jenis":"komplain|keputusan|lokasi|trip|jemput|bayar|kebutuhan","pesan":5}]')
    expect(REVIEW_SYSTEM_PROMPT).toContain('"profil":[{"label":"...","pesan":N}]')
    expect(REVIEW_SYSTEM_PROMPT).toMatch(/"pesan": SATU nomor #.*Kalau ragu, hilangkan "pesan"/)
  })
})

describe('poin penting per butir', () => {
  it('normalizePoint: string lama → messageId null; objek membawa messageId', () => {
    expect(normalizePoint('3 Oktober')).toEqual({ teks: '3 Oktober', messageId: null, jenis: null })
    expect(normalizePoint({ teks: '3 Oktober' })).toEqual({ teks: '3 Oktober', messageId: null, jenis: null })
    expect(normalizePoint({ teks: '3 Oktober', messageId: 'm5', jenis: 'trip' })).toEqual({ teks: '3 Oktober', messageId: 'm5', jenis: 'trip' })
  })
})

describe('poin penting berjenis + label profil (owner 2026-10-22, dari pembacaan 507 chat)', () => {
  const ids = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6']
  const raw = (over: Record<string, unknown>) => JSON.stringify({ ...valid, ...over })

  it('poin diurutkan menurut prioritas jenis, satu per jenis, jenis tak dikenal jadi poin biasa di belakang', () => {
    const r = parseReview(
      raw({
        poinPenting: [
          { jenis: 'trip', teks: '26 Okt, 4D3N, 2 pax', pesan: 2 },
          { jenis: 'cuaca', teks: 'Ada topan', pesan: 3 },
          { jenis: 'keputusan', teks: 'Pilih 3D/4D, paling lambat 25 Okt', pesan: 4 },
          { jenis: 'trip', teks: 'duplikat trip', pesan: 5 },
          { jenis: 'kebutuhan', teks: 'Twin room', pesan: 6 },
          { jenis: 'komplain', teks: 'Jemputan telat 1 jam; minta maaf; belum dijawab', pesan: 1 },
        ],
      }),
      ids
    )
    expect(r?.poinPenting).toEqual([
      // Komplain selalu paling atas: label "Ada komplain" tidak menjelaskan isinya.
      { jenis: 'komplain', teks: 'Jemputan telat 1 jam; minta maaf; belum dijawab', messageId: 'm1' },
      { jenis: 'keputusan', teks: 'Pilih 3D/4D, paling lambat 25 Okt', messageId: 'm4' },
      { jenis: 'trip', teks: '26 Okt, 4D3N, 2 pax', messageId: 'm2' },
      { jenis: 'kebutuhan', teks: 'Twin room', messageId: 'm6' },
      { teks: 'Ada topan', messageId: 'm3' },
    ])
    expect(REVIEW_SYSTEM_PROMPT).toContain('WAJIB ada bila "profil" memuat "komplain"')
    expect(REVIEW_SYSTEM_PROMPT).toContain('Setiap label di "profil" WAJIB dijelaskan rinciannya di poin jenis yang sesuai')
  })

  it('label profil: hanya kosakata tetap, wajib bukti pesan yang valid, satu kali per label, rombongan maks. satu', () => {
    const r = parseReview(
      raw({
        profil: [
          { label: 'banyak_revisi', pesan: 2 },
          { label: 'banyak_revisi', pesan: 4 },
          { label: 'ribet', pesan: 3 },
          { label: 'komplain' },
          { label: 'sensitif_harga', pesan: 99 },
          { label: 'pasangan', pesan: 1 },
          { label: 'keluarga_anak', pesan: 5 },
        ],
      }),
      ids
    )
    expect(r?.profil).toEqual([
      { label: 'banyak_revisi', messageId: 'm2' },
      { label: 'pasangan', messageId: 'm1' },
    ])
  })

  it('bukan tamu (mitra/lainnya): maks. 2 poin, hanya label "bukan_tamu"', () => {
    const r = parseReview(
      raw({
        jenisKontak: 'mitra',
        poinPenting: ['a', 'b', 'c'],
        profil: [{ label: 'bukan_tamu', pesan: 1 }, { label: 'sensitif_harga', pesan: 2 }],
      }),
      ids
    )
    expect(r?.poinPenting).toEqual(['a', 'b'])
    expect(r?.profil).toEqual([{ label: 'bukan_tamu', messageId: 'm1' }])
  })

  it('memperbaiki dua kerusakan JSON yang teramati di produksi: kunci "teks" hilang, dan "pesan" berisi beberapa nomor', () => {
    const broken = JSON.stringify({ ...valid, poinPenting: [] }).replace(
      '"poinPenting":[]',
      '"poinPenting":[{"jenis":"trip":"11-12 Okt, 2D1N, 3 orang","pesan":2,5},{"jenis":"jemput","teks":"Hotel 88","pesan":3}]'
    )
    expect(() => JSON.parse(broken)).toThrow()
    expect(parseReview(broken, ids)?.poinPenting).toEqual([
      { jenis: 'trip', teks: '11-12 Okt, 2D1N, 3 orang', messageId: 'm2' },
      { jenis: 'jemput', teks: 'Hotel 88', messageId: 'm3' },
    ])
  })

  it('nomor transkrip yang diselipkan ke teks ("via Wise #25", "(#3, #4)") dibuang', () => {
    const r = parseReview(raw({ poinPenting: [{ jenis: 'bayar', teks: 'Refund dikirim via Wise #25', pesan: 2 }], langkahBerikut: 'Cek bukti transfer (#3, #4).' }), ids)
    expect(r?.poinPenting).toEqual([{ jenis: 'bayar', teks: 'Refund dikirim via Wise', messageId: 'm2' }])
    expect(r?.langkahBerikut).toBe('Cek bukti transfer.')
  })

  it('JSON rusak dengan bentuk lain tetap gagal (tidak ditebak)', () => {
    expect(parseReview('{"status":"selesai","alasan":"x" "topik":"y"}', ids)).toBeNull()
  })

  it('ringkasan lama tanpa "profil" atau "profil" bukan array -> []', () => {
    expect(parseReview(raw({}), ids)?.profil).toEqual([])
    expect(parseReview(raw({ profil: 'x' }), ids)?.profil).toEqual([])
  })

  it('data booking masuk prompt sebagai konteks; tanpa booking tidak ada bagiannya', () => {
    expect(buildReviewPrompt('#1 TAMU: halo', ['active'], '- Kode: JVTO-1')).toContain('Data booking (sudah tercatat di sistem; jangan diulang sebagai poin penting):\n- Kode: JVTO-1')
    expect(buildReviewPrompt('#1 TAMU: halo', ['active'])).not.toContain('Data booking')
    expect(REVIEW_SYSTEM_PROMPT).toContain('JANGAN menulis poin yang isinya sudah sama dengan data booking')
  })
})

describe('pesan → messageId', () => {
  const ids = ['m1', 'm2', 'm3', 'm4', 'm5']
  const parseWith = (patch: Record<string, unknown>) => parseReview(JSON.stringify({ ...valid, ...patch }), ids)

  it('resolvePesan menerima angka, "3", dan "#3"; menolak di luar jangkauan dan bentuk lain', () => {
    expect(resolvePesan(3, ids)).toBe('m3')
    expect(resolvePesan('3', ids)).toBe('m3')
    expect(resolvePesan('#3', ids)).toBe('m3')
    expect(resolvePesan(' # 5 ', ids)).toBe('m5')
    for (const bad of [0, 6, -1, 2.5, '7', '#0', 'tiga', '3a', null, undefined, true, [3], { n: 3 }]) {
      expect(resolvePesan(bad, ids)).toBeUndefined()
    }
    expect(resolvePesan(1, [])).toBeUndefined()
  })

  it('pertanyaan: pesan valid jadi messageId, nomor mentah tidak disimpan', () => {
    const review = parseWith({
      pertanyaan: [
        { teks: 'Harga?', terjawab: false, pesan: 3 },
        { teks: 'Jemput?', terjawab: true, pesan: '#1' },
        { teks: 'Pax?', terjawab: 'true', pesan: '2' },
      ],
    })
    expect(review?.pertanyaan).toEqual([
      { teks: 'Harga?', terjawab: false, messageId: 'm3' },
      { teks: 'Jemput?', terjawab: true, messageId: 'm1' },
      { teks: 'Pax?', terjawab: true, messageId: 'm2' },
    ])
    expect(JSON.stringify(review)).not.toContain('"pesan"')
  })

  it('pertanyaan: pesan di luar jangkauan atau hilang → tanpa messageId, item tetap ada', () => {
    const review = parseWith({
      pertanyaan: [{ teks: 'A?', terjawab: false, pesan: 9 }, { teks: 'B?', terjawab: true }, { teks: 'C?', terjawab: false, pesan: 'x' }],
    })
    expect(review?.pertanyaan).toEqual([
      { teks: 'A?', terjawab: false },
      { teks: 'B?', terjawab: true },
      { teks: 'C?', terjawab: false },
    ])
    for (const q of review?.pertanyaan ?? []) expect(q).not.toHaveProperty('messageId')
  })

  it('poinPenting: objek dengan pesan valid jadi { teks, messageId }, tanpa pesan jadi string polos', () => {
    const review = parseWith({
      poinPenting: [{ teks: ' 3 Oktober ', pesan: 5 }, { teks: '2 orang', pesan: '#2' }, { teks: 'Dari Surabaya' }, { teks: 'Hotel', pesan: 99 }, 'Paket Ijen'],
    })
    expect(review?.poinPenting).toEqual([
      { teks: '3 Oktober', messageId: 'm5' },
      { teks: '2 orang', messageId: 'm2' },
      'Dari Surabaya',
      'Hotel',
      'Paket Ijen',
    ])
    expect(JSON.stringify(review)).not.toContain('"pesan"')
  })

  it('poinPenting: item rusak dibuang tanpa menggagalkan ringkasan', () => {
    const review = parseWith({ poinPenting: [42, null, {}, { teks: 7, pesan: 1 }, [], { teks: '   ', pesan: 1 }, { teks: 'Ok', pesan: 1 }] })
    expect(review).not.toBeNull()
    expect(review?.poinPenting).toEqual([{ teks: 'Ok', messageId: 'm1' }])
  })

  it('string lama di kedua daftar tetap valid', () => {
    expect(parseWith({ pertanyaan: ['Harga?'], poinPenting: ['3 Oktober'] })).toMatchObject({ pertanyaan: ['Harga?'], poinPenting: ['3 Oktober'] })
  })

  it('tanpa ids, setiap pesan dibuang', () => {
    const review = parseReview(JSON.stringify({ ...valid, pertanyaan: [{ teks: 'A?', terjawab: true, pesan: 1 }], poinPenting: [{ teks: 'B', pesan: 1 }] }))
    expect(review?.pertanyaan).toEqual([{ teks: 'A?', terjawab: true }])
    expect(review?.poinPenting).toEqual(['B'])
  })

  it('reviewConversation meneruskan ids transkrip ke parser', async () => {
    vi.mocked(callLLM).mockResolvedValue(JSON.stringify({ ...valid, poinPenting: [{ teks: 'Tanggal', pesan: 2 }] }))
    const review = await reviewConversation({ text: '#1 a\n#2 b', ids: ['x1', 'x2'] }, ['active'], undefined)
    expect(review?.poinPenting).toEqual([{ teks: 'Tanggal', messageId: 'x2' }])
    expect(vi.mocked(callLLM).mock.calls[0][0]).toContain('#1 a\n#2 b')
  })
})

describe('janji tim', () => {
  const ids = ['m1', 'm2', 'm3', 'm4', 'm5']
  const parseJ = (janjiTim: unknown) => parseReview(JSON.stringify({ ...valid, janjiTim }), ids)

  it('prompt meminta janjiTim berbentuk objek dengan terpenuhi dan pesan', () => {
    expect(REVIEW_SYSTEM_PROMPT).toContain('"janjiTim":[{"teks":"...","terpenuhi":true|false,"pesan":N}]')
    expect(REVIEW_SYSTEM_PROMPT).toMatch(/"janjiTim": komitmen yang diucapkan TIM/)
    // Janji yang ditepati tetap membawa nomor pesan janjinya: penutupan PROMISE_KEPT mencocokkan lewat id, bukan teks.
    expect(REVIEW_SYSTEM_PROMPT).toMatch(/sudah terpenuhi tetap ditulis dengan "pesan" tempat janji itu DIUCAPKAN/)
    expect(REVIEW_SYSTEM_PROMPT).toMatch(/"terpenuhi" bernilai true HANYA bila transkrip menunjukkan janji itu sudah dilakukan/)
  })

  it('pesan valid jadi messageId, nomor mentah tidak disimpan; "true"/"false" jadi boolean', () => {
    const review = parseJ([
      { teks: ' Kirim invoice ', terpenuhi: false, pesan: 4 },
      { teks: 'Cek ketersediaan', terpenuhi: 'true', pesan: '#2' },
      { teks: 'Itinerary besok', terpenuhi: false, pesan: 99 },
    ])
    expect(review?.janjiTim).toEqual([
      { teks: 'Kirim invoice', terpenuhi: false, messageId: 'm4' },
      { teks: 'Cek ketersediaan', terpenuhi: true, messageId: 'm2' },
      { teks: 'Itinerary besok', terpenuhi: false },
    ])
    expect(JSON.stringify(review)).not.toContain('"pesan"')
  })

  it('toleran per butir: string tetap, terpenuhi tidak valid jadi string, sampah dibuang', () => {
    const review = parseJ(['Konfirmasi jemput', { teks: 'Harga', terpenuhi: 'mungkin' }, 42, null, {}, { teks: 7 }, { teks: '  ', terpenuhi: false }])
    expect(review).not.toBeNull()
    expect(review?.janjiTim).toEqual(['Konfirmasi jemput', 'Harga'])
  })

  it('janjiTim bukan array dianggap kosong, ringkasan tetap lolos; dibatasi 5 butir', () => {
    expect(parseJ('invoice menyusul')?.janjiTim).toEqual([])
    expect(parseJ(null)?.janjiTim).toEqual([])
    expect(parseJ(['1', '2', '3', '4', '5', '6'])?.janjiTim).toHaveLength(5)
  })

  it('normalizePromise dan unkeptPromises: hanya terpenuhi:false yang dihitung belum ditepati', () => {
    expect(normalizePromise('Invoice')).toEqual({ teks: 'Invoice', terpenuhi: null, messageId: null })
    expect(normalizePromise({ teks: 'Invoice', terpenuhi: false, messageId: 'm2' })).toEqual({ teks: 'Invoice', terpenuhi: false, messageId: 'm2' })
    expect(
      unkeptPromises({ janjiTim: ['Lama', { teks: 'Sudah', terpenuhi: true }, { teks: 'Belum', terpenuhi: false, messageId: 'm3' }] })
    ).toEqual([{ teks: 'Belum', terpenuhi: false, messageId: 'm3' }])
  })
})
