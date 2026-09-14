import { describe, it, expect } from 'vitest'
import { findNamedPackage } from './package-match'
import { loadCatalog } from './catalog'

// Dilaporkan 14 September 2026 (Sakura): pelanggan menyebut paketnya -- judul lengkap DAN link
// halaman paket -- tetapi bot tetap meminta formulir start/finish/jumlah hari, karena tidak ada yang
// mencocokkan judul atau link paket di pesan pelanggan. Test ini memakai katalog ASLI, bukan fixture:
// yang dipertaruhkan justru apakah judul/link sungguhan terbaca unik.
const catalog = loadCatalog()

const SAKURA =
  "Hi JVTO, I'm interested in booking 4 DAY IJEN, PAPUMA BEACH, TUMPAK SEWU & BROMO JOURNEY FROM SURABAYA. \n" +
  'https://javavolcano-touroperator.com/tours/from-surabaya/ijen-papuma-tumpak-sewu-bromo-4d3n\n\n' +
  'We are 2 guests. Could you please let us know the additional cost for this?'

describe('findNamedPackage', () => {
  it('mengenali paket Sakura dari judul dan link-nya', () => {
    expect(findNamedPackage(SAKURA, catalog.packages)?.packageKey).toBe('ijen-papuma-tumpak-sewu-bromo-4d3n')
  })

  it('mengenali link paket saja, tanpa judul', () => {
    const message = 'Is this still available? https://javavolcano-touroperator.com/tours/from-surabaya/bromo-1d1n'
    expect(findNamedPackage(message, catalog.packages)?.packageKey).toBe('bromo-1d1n')
  })

  // Teks pelanggan asli dari database: judul huruf kapital di dalam tanda kutip.
  it('mengenali judul huruf kapital di dalam tanda kutip', () => {
    const message = 'Yes, it’ll be the “3 DAY BROMO, MADAKARIPURA & IJEN OVERLAND FROM SURABAYA TO BALI” for 2 people'
    expect(findNamedPackage(message, catalog.packages)?.packageKey).toBe('bromo-madakaripura-ijen-3d2n')
  })

  it('membedakan paket berjudul mirip dari Bali dan dari Surabaya lewat link', () => {
    const fromBali = findNamedPackage('https://javavolcano-touroperator.com/tours/from-bali/ijen-papuma-tumpak-sewu-bromo-5d4n', catalog.packages)
    const fromSurabaya = findNamedPackage('https://javavolcano-touroperator.com/tours/from-surabaya/ijen-papuma-tumpak-sewu-bromo-5d4n', catalog.packages)
    expect(fromBali?.origin).toBe('Bali')
    expect(fromSurabaya?.origin).toBe('Surabaya')
    expect(fromBali?.packageKey).not.toBe(fromSurabaya?.packageKey)
  })

  // Tidak menebak: menyebut destinasi dan durasi BUKAN menyebut paket. Pelanggan seperti ini tetap
  // harus melewati formulir supaya bot tidak memilihkan paket yang salah.
  it('tidak mengenali pesan yang hanya menyebut destinasi dan durasi', () => {
    expect(findNamedPackage('We want Bromo and Ijen for 3 days from Surabaya. What is the price for 2 people?', catalog.packages)).toBeNull()
  })

  it('tidak mengenali link halaman lain di website yang sama', () => {
    expect(findNamedPackage('https://javavolcano-touroperator.com/travel-guide/booking-information', catalog.packages)).toBeNull()
  })

  // Pemeriksa mekanis atas SELURUH katalog: setiap paket harus kembali ke dirinya sendiri, baik dari
  // judul maupun dari link-nya. Kalau suatu hari dua judul menjadi terlalu mirip, test ini gagal
  // lebih dulu daripada pelanggan yang menerima paket yang salah.
  it('setiap paket di katalog dikenali persis dari judul dan link-nya sendiri', () => {
    const wrong: string[] = []
    for (const p of catalog.packages) {
      const byTitle = findNamedPackage(`We are interested in the ${p.title} please.`, catalog.packages)
      if (byTitle?.packageKey !== p.packageKey) wrong.push(`judul ${p.packageKey} -> ${byTitle?.packageKey ?? 'null'}`)
      const url = p.links.details
      if (url) {
        const byUrl = findNamedPackage(`Link: ${url}`, catalog.packages)
        if (byUrl?.packageKey !== p.packageKey) wrong.push(`link ${p.packageKey} -> ${byUrl?.packageKey ?? 'null'}`)
      }
    }
    expect(catalog.packages.length).toBeGreaterThan(10)
    expect(wrong).toEqual([])
  })
})
