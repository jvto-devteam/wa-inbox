import { describe, it, expect } from 'vitest'
import { mergeScheduleNote, type WaNoteState } from './merge'

const AT = new Date('2026-11-13T05:00:00.000Z')
const merge = (current: string | null, incoming: string[], state: WaNoteState | null = null) => mergeScheduleNote({ current, state, incoming, at: AT })
/** Menerapkan hasil seperti penulis: note baru jadi `current`, state disimpan. */
const apply = (current: string | null, incoming: string[], state: WaNoteState | null) => {
  const r = merge(current, incoming, state)
  return { note: r.note, state: r.state, changed: r.changed }
}

describe('mergeScheduleNote: tiga aturan pemilik, tanpa judul', () => {
  it('1. note kosong: note penuh dari chat WA, hanya butir, tanpa judul atau teks "chat WA"', () => {
    const r = merge(null, ['1 orang vegan', 'Minta AC mobil dingin'])
    expect(r.note).toBe('- 1 orang vegan\n- Minta AC mobil dingin')
    expect(r.note).not.toMatch(/chat\s*wa/i)
    expect(r.changed).toBe(true)
    expect(r.state.lines).toEqual(['1 orang vegan', 'Minta AC mobil dingin'])
    expect(r.state.prev).toBeNull()
  })

  it('2. note admin ada: jadi satu note, tulisan admin utuh di atas, butir kita di bawah', () => {
    const admin = '- Driver: Egy\n- Guide ijen: Andi\nTagihkan cash'
    const r = merge(admin, ['1 orang vegan'])
    expect(r.note).toBe(`${admin}\n- 1 orang vegan`)
    expect(r.state.prev).toBe(admin)
    expect(r.state.admin).toBe(admin)
  })

  it('3. tidak dobel: poin yang sudah ditulis admin tidak ditambahkan lagi', () => {
    const r = merge('- Vegan 2 orang\n- Driver: Egy', ['vegan 2 orang', 'Minta AC mobil dingin'])
    expect(r.note).toBe('- Vegan 2 orang\n- Driver: Egy\n- Minta AC mobil dingin')
  })

  it('3b. tidak dobel menurut makna: kata bermakna sudah ditulis admin (angka dan "tamu/orang" diabaikan)', () => {
    const r = merge('Move hotel to Padis,\nDInner dGarden;\n\nVEGAN', ['2 tamu vegan', 'Minta AC mobil dingin'])
    expect(r.note).toBe('Move hotel to Padis,\nDInner dGarden;\n\nVEGAN\n- Minta AC mobil dingin')
    expect(merge('AC', ['Minta AC mobil dingin']).note).toContain('- Minta AC mobil dingin')
    expect(merge('VEGAN', ['1 orang vegetarian']).note).toContain('- 1 orang vegetarian')
    expect(merge('Driver: Egy', ['2 tamu']).note).toContain('- 2 tamu')
  })

  it('idempoten: menjalankan lagi dengan poin sama tidak mengubah apa pun', () => {
    const first = apply('Driver: Egy', ['1 orang vegan'], null)
    const second = merge(first.note, ['1 orang vegan'], first.state)
    expect(second.changed).toBe(false)
    expect(second.note).toBe(first.note)
  })
})

describe('mergeScheduleNote: tulisan admin tidak pernah hilang', () => {
  it('admin menambah teks di atas, di bawah, dan di antara butir kita, lalu chat berubah: semua tulisan admin tetap ada', () => {
    const w1 = apply('Driver: Egy', ['1 orang vegan', 'Minta AC mobil dingin'], null)
    const edited = `Catatan baru admin\n${w1.note}\n- Admin menambah di tengah\n\nTambahan paling bawah`
    const w2 = merge(edited, ['1 orang vegan', 'Bawa drone'], w1.state)
    for (const kept of ['Catatan baru admin', 'Driver: Egy', 'Admin menambah di tengah', 'Tambahan paling bawah']) expect(w2.note).toContain(kept)
    expect(w2.note).toContain('- Bawa drone')
    expect(w2.note).not.toContain('Minta AC mobil dingin')
    expect(w2.state.dismissed).toEqual([])
  })

  it('admin menghapus SEBAGIAN butir: butir itu tidak ditulis ulang walau chat masih menghasilkannya', () => {
    const w1 = apply(null, ['1 orang vegan', 'Minta AC mobil dingin'], null)
    const w2 = apply('- 1 orang vegan', ['1 orang vegan', 'Minta AC mobil dingin'], w1.state)
    expect(w2.changed).toBe(false)
    expect(w2.state.dismissed).toEqual(['Minta AC mobil dingin'])
    const w3 = merge(w2.note, ['1 orang vegan', 'Minta AC mobil dingin', 'Bawa drone'], w2.state)
    expect(w3.note).toBe('- 1 orang vegan\n- Bawa drone')
  })

  it('admin menghapus SEMUA butir kita tetapi tulisannya sendiri utuh: tidak ditulis ulang', () => {
    const w1 = apply('Driver: Egy', ['1 orang vegan'], null)
    const w2 = merge('Driver: Egy', ['1 orang vegan'], w1.state)
    expect(w2.state.dismissed).toEqual(['1 orang vegan'])
    expect(w2.changed).toBe(false)
    expect(w2.note).toBe('Driver: Egy')
  })

  it('admin mengosongkan seluruh note: tidak ditulis ulang', () => {
    const w1 = apply(null, ['1 orang vegan'], null)
    const w2 = merge('', ['1 orang vegan'], w1.state)
    expect(w2.state.dismissed).toEqual(['1 orang vegan'])
    expect(w2.note).toBeNull()
  })

  it('admin mengubah kalimat butir kita: versi admin tetap sebagai tulisan admin, versi lama tidak muncul lagi', () => {
    const w1 = apply('Driver: Egy', ['1 orang vegan', 'Bawa drone'], null)
    const edited = w1.note!.replace('- 1 orang vegan', '- 2 orang vegan (anak dan ibu)')
    const w2 = merge(edited, ['1 orang vegan', 'Bawa drone'], w1.state)
    expect(w2.note).toBe('Driver: Egy\n- 2 orang vegan (anak dan ibu)\n- Bawa drone')
    expect(w2.note).not.toContain('- 1 orang vegan')
  })

  it('note ditimpa jalur lain (import Excel, form lama): butir ditulis lagi, TIDAK dianggap dihapus admin', () => {
    const w1 = apply('Driver: Egy', ['1 orang vegan'], null)
    const w2 = merge('Isi dari import Excel', ['1 orang vegan'], w1.state)
    expect(w2.note).toBe('Isi dari import Excel\n- 1 orang vegan')
    expect(w2.state.dismissed).toEqual([])
  })

  it('tanpa state.admin (backoffice lama): semua butir hilang dibaca sebagai penimpaan, bukan keputusan admin', () => {
    const state: WaNoteState = { lines: ['1 orang vegan'], dismissed: [], prev: null, at: '' }
    const r = merge('Driver: Egy', ['1 orang vegan'], state)
    expect(r.note).toBe('Driver: Egy\n- 1 orang vegan')
    expect(r.state.dismissed).toEqual([])
  })

  it('poin chat habis: butir dibuang, bagian admin tetap; keduanya kosong: note null', () => {
    const w1 = apply('Driver: Egy', ['1 orang vegan'], null)
    expect(merge(w1.note, [], w1.state).note).toBe('Driver: Egy')
    const w2 = apply(null, ['1 orang vegan'], null)
    expect(merge(w2.note, [], w2.state).note).toBeNull()
  })

  it('format lama (judul "— Dari chat WA —"): judul dibuang dan butir dipindah ke format baru, tulisan admin utuh', () => {
    const legacy = 'Move hotel to Padis,\nDInner dGarden;\n\nVEGAN\n\n— Dari chat WA —\n- Minta AC mobil dingin'
    const state: WaNoteState = { lines: ['Minta AC mobil dingin'], dismissed: [], prev: null, at: '' }
    const r = merge(legacy, ['Minta AC mobil dingin'], state)
    expect(r.note).toBe('Move hotel to Padis,\nDInner dGarden;\n\nVEGAN\n- Minta AC mobil dingin')
    expect(r.note).not.toMatch(/chat\s*wa/i)
    expect(r.changed).toBe(true)
    // Blok lama saja: jadi butir saja.
    expect(merge('— Dari chat WA —\n- 1 orang vegetarian', ['1 orang vegetarian'], { lines: ['1 orang vegetarian'], dismissed: [], prev: null, at: '' }).note).toBe('- 1 orang vegetarian')
  })

  it('PEMERIKSA: setiap baris tulisan admin tetap ada, berurutan, persis sama (CRLF, spasi dalam, unicode, baris kosong)', () => {
    const adminSamples = [
      'Driver: Egy',
      '- Upgrade ke Artotel (by client)\r\n- Bakar belerang simulasikan blue fire',
      'Getyourguide: GYGX7M9G8R8Q\n\n- Bantu medical check up tanggal 7',
      '  teks dengan   spasi   dalam  ',
      'Tamu 😀 VIP — jangan lupa «welcome drink» 東京',
      `${'baris panjang '.repeat(40)}`,
      '- a\n- b\n- c\n\n\n- d',
    ]
    const incoming = [['1 orang vegan'], ['Minta AC mobil dingin', 'Bawa drone'], []]
    for (const admin of adminSamples) {
      const adminRows = admin.trim().split('\n')
      for (const lines of incoming) {
        const r1 = merge(admin, lines, null)
        const r2 = merge(r1.note, ['Poin lain'], r1.state)
        for (const r of [r1, r2]) {
          const got = (r.note ?? '').split('\n')
          // Baris admin muncul persis dan berurutan sebagai awalan note (butir kita selalu di akhir).
          expect(got.slice(0, adminRows.length)).toEqual(adminRows)
        }
      }
    }
  })
})

describe('mergeScheduleNote: batasan dan keamanan', () => {
  it('poin berisi "confirm" tidak ditulis (legacy mewarnai note dengan str_contains confirm)', () => {
    expect(merge(null, ['Tamu confirmed vegan', 'Minta AC mobil dingin']).note).toBe('- Minta AC mobil dingin')
  })

  it('poin kosong, duplikat, atau berawalan bullet dirapikan', () => {
    expect(merge(null, ['', '  - 1 orang vegan  ', '1 ORANG VEGAN', '•  Bawa drone']).state.lines).toEqual(['1 orang vegan', 'Bawa drone'])
  })

  it('daftar dismissed dibatasi lima puluh', () => {
    const lines = Array.from({ length: 60 }, (_, i) => `poin nomor ${i} drone`)
    const w1 = apply(null, lines.slice(0, 5), null)
    const many: WaNoteState = { ...w1.state, dismissed: lines }
    expect(merge(w1.note, [], many).state.dismissed.length).toBeLessThanOrEqual(50)
  })

  it('prev menyimpan note utuh sebelum penulisan yang mengubahnya, dan tidak berubah bila tidak ada perubahan', () => {
    const w1 = apply('Driver: Egy', ['1 orang vegan'], null)
    expect(w1.state.prev).toBe('Driver: Egy')
    const w2 = merge(w1.note, ['1 orang vegan'], w1.state)
    expect(w2.changed).toBe(false)
    expect(w2.state.prev).toBe('Driver: Egy')
  })
})
