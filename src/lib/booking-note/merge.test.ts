import { describe, it, expect } from 'vitest'
import { mergeScheduleNote, WA_NOTE_HEADER as H, type WaNoteState } from './merge'

const AT = new Date('2026-11-13T05:00:00.000Z')
const merge = (current: string | null, incoming: string[], state: WaNoteState | null = null) => mergeScheduleNote({ current, state, incoming, at: AT })
/** Menerapkan hasil seperti yang dilakukan penulis: note baru jadi `current`, state disimpan. */
const apply = (current: string | null, incoming: string[], state: WaNoteState | null) => {
  const r = merge(current, incoming, state)
  return { note: r.note, state: r.state, changed: r.changed }
}

describe('mergeScheduleNote: tiga aturan pemilik', () => {
  it('1. note kosong: note penuh dari chat WA', () => {
    const r = merge(null, ['1 orang vegan', 'Minta AC mobil dingin'])
    expect(r.note).toBe(`${H}\n- 1 orang vegan\n- Minta AC mobil dingin`)
    expect(r.changed).toBe(true)
    expect(r.state.lines).toEqual(['1 orang vegan', 'Minta AC mobil dingin'])
    expect(r.state.prev).toBeNull()
  })

  it('2. note admin ada: jadi satu note, tulisan admin utuh di atas, blok di bawah', () => {
    const admin = '- Driver: Egy\n- Guide ijen: Andi\nTagihkan cash'
    const r = merge(admin, ['1 orang vegan'])
    expect(r.note).toBe(`${admin}\n\n${H}\n- 1 orang vegan`)
    expect(r.state.prev).toBe(admin)
  })

  it('3. tidak dobel: poin yang sudah ditulis admin tidak ditambahkan lagi', () => {
    const r = merge('- Vegan 2 orang\n- Driver: Egy', ['vegan 2 orang', 'Minta AC mobil dingin'])
    expect(r.note).toBe(`- Vegan 2 orang\n- Driver: Egy\n\n${H}\n- Minta AC mobil dingin`)
  })

  it('3b. tidak dobel menurut makna: kata bermakna sudah ditulis admin (angka dan "tamu/orang" diabaikan)', () => {
    const r = merge('Move hotel to Padis,\nDInner dGarden;\n\nVEGAN', ['2 tamu vegan', 'Minta AC mobil dingin'])
    expect(r.note).toBe(`Move hotel to Padis,\nDInner dGarden;\n\nVEGAN\n\n${H}\n- Minta AC mobil dingin`)
    // Hanya sebagian kata yang sudah ada: tetap ditulis (maknanya berbeda).
    expect(merge('AC', ['Minta AC mobil dingin']).note).toContain('- Minta AC mobil dingin')
    expect(merge('VEGAN', ['1 orang vegetarian']).note).toContain('- 1 orang vegetarian')
    // Tidak ada kata bermakna sama sekali (hanya angka/kata umum): tidak dianggap dobel.
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
  it('admin menambah teks di ATAS, di BAWAH, dan DI DALAM blok, lalu chat berubah: semua tetap ada', () => {
    const w1 = apply('Driver: Egy', ['1 orang vegan', 'Minta AC mobil dingin'], null)
    const edited = `Catatan baru admin\n${w1.note}\n- Admin menambah di dalam blok\n\nTambahan paling bawah`
    const w2 = merge(edited, ['1 orang vegan', 'Bawa drone'], w1.state)
    expect(w2.note).toContain('Catatan baru admin')
    expect(w2.note).toContain('Driver: Egy')
    expect(w2.note).toContain('Admin menambah di dalam blok')
    expect(w2.note).toContain('Tambahan paling bawah')
    expect(w2.note).toContain('- Bawa drone')
    expect(w2.note).not.toContain('Minta AC mobil dingin')
  })

  it('admin menghapus satu baris blok: baris itu tidak ditulis ulang walau chat masih menghasilkannya', () => {
    const w1 = apply(null, ['1 orang vegan', 'Minta AC mobil dingin'], null)
    const afterDelete = `${H}\n- 1 orang vegan`
    const w2 = apply(afterDelete, ['1 orang vegan', 'Minta AC mobil dingin'], w1.state)
    expect(w2.changed).toBe(false)
    expect(w2.state.dismissed).toEqual(['Minta AC mobil dingin'])
    const w3 = merge(w2.note, ['1 orang vegan', 'Minta AC mobil dingin', 'Bawa drone'], w2.state)
    expect(w3.note).toBe(`${H}\n- 1 orang vegan\n- Bawa drone`)
  })

  it('admin mengubah kalimat baris blok: versi admin dipertahankan sebagai tulisan admin, versi lama tidak muncul lagi', () => {
    const w1 = apply('Driver: Egy', ['1 orang vegan'], null)
    const edited = w1.note!.replace('- 1 orang vegan', '- 2 orang vegan (anak dan ibu)')
    const w2 = merge(edited, ['1 orang vegan'], w1.state)
    expect(w2.note).toBe('Driver: Egy\n- 2 orang vegan (anak dan ibu)')
    expect(w2.note).not.toContain('- 1 orang vegan')
  })

  it('note ditimpa jalur lain (import Excel, form lama) sehingga blok hilang: blok ditulis lagi, TIDAK dianggap dihapus admin', () => {
    const w1 = apply('Driver: Egy', ['1 orang vegan'], null)
    const overwritten = 'Isi dari import Excel'
    const w2 = merge(overwritten, ['1 orang vegan'], w1.state)
    expect(w2.note).toBe(`Isi dari import Excel\n\n${H}\n- 1 orang vegan`)
    expect(w2.state.dismissed).toEqual([])
  })

  it('poin chat hilang semua: blok dibuang, bagian admin tetap; keduanya kosong: note null', () => {
    const w1 = apply('Driver: Egy', ['1 orang vegan'], null)
    const w2 = merge(w1.note, [], w1.state)
    expect(w2.note).toBe('Driver: Egy')
    expect(merge(`${H}\n- 1 orang vegan`, [], w1.state).note).toBeNull()
  })

  it('PEMERIKSA: bagian admin identik byte-per-byte (termasuk CRLF, spasi dalam, unicode) untuk banyak bentuk note admin', () => {
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
      for (const lines of incoming) {
        const r1 = merge(admin, lines, null)
        const trimmed = admin.trim()
        expect(r1.note === null ? '' : r1.note.startsWith(trimmed)).toBe(true)
        // Putaran kedua dengan chat berbeda tidak boleh mengubah bagian admin sedikit pun.
        const r2 = merge(r1.note, ['Poin lain'], r1.state)
        expect(r2.note?.startsWith(trimmed)).toBe(true)
        expect((r2.note ?? '').split(`\n\n${H}`)[0]).toBe(trimmed)
      }
    }
  })
})

describe('mergeScheduleNote: batasan dan keamanan', () => {
  it('poin berisi "confirm" tidak ditulis (legacy mewarnai note dengan str_contains confirm)', () => {
    const r = merge(null, ['Tamu confirmed vegan', 'Minta AC mobil dingin'])
    expect(r.note).toBe(`${H}\n- Minta AC mobil dingin`)
  })

  it('poin kosong, duplikat, atau berawalan bullet dirapikan', () => {
    const r = merge(null, ['', '  - 1 orang vegan  ', '1 ORANG VEGAN', '•  Bawa drone'])
    expect(r.state.lines).toEqual(['1 orang vegan', 'Bawa drone'])
  })

  it('daftar dismissed dibatasi lima puluh', () => {
    const lines = Array.from({ length: 60 }, (_, i) => `poin nomor ${i} drone`)
    const w1 = apply(null, lines.slice(0, 5), null)
    const manyDismissed: WaNoteState = { ...w1.state, dismissed: lines }
    expect(merge(w1.note, [], manyDismissed).state.dismissed.length).toBeLessThanOrEqual(50)
  })

  it('prev menyimpan note utuh sebelum penulisan yang mengubahnya, dan tidak berubah bila tidak ada perubahan', () => {
    const w1 = apply('Driver: Egy', ['1 orang vegan'], null)
    expect(w1.state.prev).toBe('Driver: Egy')
    const w2 = merge(w1.note, ['1 orang vegan'], w1.state)
    expect(w2.changed).toBe(false)
    expect(w2.state.prev).toBe('Driver: Egy')
  })
})
