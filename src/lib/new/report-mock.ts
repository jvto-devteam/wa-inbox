// DATA CONTOH untuk menu Laporan /new: percakapan WhatsApp fiktif, dibentuk relatif terhadap hari ini
// supaya "Minggu ini" dan tren 8 minggu selalu berisi. Tidak ada yang dibaca dari database.
import { addDays, type LeadBlockerNote, type ReportRow } from './report'

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** Bentuk booking_date dari API booking: "03 Sep 2026". */
function bookingDate(ymd: string): string {
  const [y, m, d] = ymd.split('-')
  return d + ' ' + MON[+m - 1] + ' ' + y
}
function at(ymd: string, hour: number): Date {
  return new Date(Date.parse(ymd + 'T' + String(hour).padStart(2, '0') + ':00:00+07:00'))
}

const PKG = ['3D Bromo · Ijen', '4D Ijen · Tumpak Sewu', '3D2N Bromo · Ijen', '2D Bromo Sunrise', '4D3N Ijen · Bromo', '3D Bromo · Madakaripura']
const NAMES = ['Anna B.', 'Ben C.', 'Chloe D.', 'Daniel E.', 'Eva F.', 'Felix G.', 'Grace H.', 'Hugo I.', 'Iris J.', 'Jack K.', 'Kira L.', 'Leo M.', 'Maya N.', 'Nico O.', 'Olga P.', 'Paul Q.']

interface Seed {
  n: string
  chat: number
  hour?: number
  booked?: number
  kind?: string
  last?: number
  dir?: 'INBOUND' | 'OUTBOUND'
  blocker?: LeadBlockerNote
  ch?: string
  next?: string
}

/** Minggu ini (offset hari terhadap hari ini). */
const THIS_WEEK: Seed[] = [
  { n: 'Emma R.', chat: 0, hour: 8, booked: 0, ch: 'JVTO' },
  { n: 'Liam T.', chat: -1, hour: 14, booked: 0, ch: 'JVTO' },
  { n: 'Lukas B.', chat: -6, hour: 9, booked: 0, ch: 'JVTO' },
  { n: 'Mei H.', chat: -10, hour: 19, booked: -1, ch: 'KLOOK' },
  { n: 'Priya S.', chat: 0, hour: 9, kind: 'calon_tamu', last: 0, dir: 'OUTBOUND',
    blocker: { alasan: 'harga', teks: 'Minta di bawah Rp4 jt untuk 2 orang (4D Bromo + Ijen).', rekomendasi: 'Tawarkan 3D2N Bromo + Ijen yang masuk budget; tanyakan tanggal pasti sore ini.' } },
  { n: 'Tom W.', chat: -1, hour: 10, kind: 'calon_tamu', last: -1, dir: 'OUTBOUND',
    blocker: { alasan: 'tamu_diam', teks: 'Harga Bromo sunrise sudah dikirim, tamu belum membalas.', rekomendasi: 'Follow-up besok pagi: tanya jumlah orang dan tanggal, tawarkan cek ketersediaan.' } },
  { n: 'Rina K.', chat: 0, hour: 11, kind: 'calon_tamu', last: 0, dir: 'OUTBOUND',
    blocker: { alasan: 'belum_pasti', teks: 'Menunggu kepastian cuti di bulan Desember.', rekomendasi: 'Ingatkan Jumat; kirim pilihan tanggal Desember yang masih tersedia.' } },
  { n: 'Marco L.', chat: 0, hour: 13, kind: 'calon_tamu', last: 0, dir: 'INBOUND',
    blocker: { alasan: 'belum_dijawab', teks: 'Tanya apakah bisa dijemput di Banyuwangi; belum dijawab tim.', rekomendasi: 'Jawab soal jemput Banyuwangi dan kirim harga untuk 2 orang.' } },
  { n: 'Hana Y.', chat: -1, hour: 16, kind: 'calon_tamu', last: -1, dir: 'OUTBOUND',
    blocker: { alasan: 'diskusi_rombongan', teks: 'Menunggu teman mengonfirmasi jumlah orang (4–6).', rekomendasi: 'Kirim harga untuk 4 dan 6 orang supaya rombongan mudah memutuskan.' } },
  { n: 'David K.', chat: -1, hour: 20, kind: 'calon_tamu', last: -1, dir: 'INBOUND',
    blocker: { alasan: 'pilih_lain', teks: 'Membandingkan dengan open trip yang lebih murah.', rekomendasi: 'Jelaskan beda private trip (jemput hotel, jadwal fleksibel); cukup satu kali follow-up.' } },
  { n: 'Ken A.', chat: 0, hour: 15, kind: 'calon_tamu', last: 0, dir: 'INBOUND',
    blocker: { alasan: 'menunggu_tim', teks: 'Tim berjanji mengirim itinerary 3D2N, belum terkirim.', rekomendasi: 'Kirim itinerary 3D2N hari ini beserta harganya.' } },
  { n: 'Sofia G.', chat: 0, hour: 17, last: 0, dir: 'INBOUND', next: 'Jawab pertanyaan harga untuk 3 orang.' },
  // tamu lama (booking sebelum chat) dan vendor: tidak dihitung sebagai lead/booking dari chat
  { n: 'Sarah M.', chat: 0, hour: 10, booked: -40, kind: 'tamu_existing', ch: 'JVTO' },
  { n: 'Vendor Transport Bali', chat: 0, hour: 7, kind: 'mitra' },
]

/** Pola 7 minggu sebelumnya: [inquiry, booking]. */
const PAST: [number, number][] = [[10, 3], [12, 4], [8, 2], [11, 4], [7, 2], [9, 3], [6, 2]]

export function reportRows(today: string): ReportRow[] {
  const seeds: Seed[] = [...THIS_WEEK]
  let k = 0
  PAST.forEach(([inq, bk], wi) => {
    const base = -7 * (wi + 1)
    for (let i = 0; i < inq; i++) {
      const chat = base - (i % 6)
      seeds.push({
        n: NAMES[k++ % NAMES.length],
        chat,
        hour: 8 + (i % 10),
        booked: i < bk ? chat + (i % 3) : undefined,
        ch: i % 3 === 2 ? 'KLOOK' : 'JVTO',
        dir: i % 2 ? 'OUTBOUND' : 'INBOUND',
        last: chat + 1,
      })
    }
  })
  return seeds.map((s, i): ReportRow => {
    const chatDay = addDays(today, s.chat)
    const bookDay = s.booked !== undefined ? addDays(today, s.booked) : null
    return {
      id: 'contoh-' + i,
      name: s.n,
      phone: '62812000' + String(1000 + i * 37).slice(-4),
      stage: bookDay ? 'booked' : 'new',
      firstIn: at(chatDay, s.hour ?? 9),
      bookingDate: bookDay ? bookingDate(bookDay) : null,
      bookingNumber: bookDay ? (s.ch === 'KLOOK' ? 'KLOOK-xxxx' : 'JVTO-xxxx') : null,
      pkg: bookDay ? PKG[i % PKG.length] : null,
      startYmd: bookDay ? addDays(bookDay, 18 + (i % 20)) : null,
      orderChannel: bookDay ? s.ch ?? 'JVTO' : null,
      kind: s.kind ?? null,
      blocker: s.blocker ?? null,
      nextStep: s.next ?? null,
      reviewAt: s.blocker ? at(addDays(today, s.last ?? s.chat), 23) : null,
      lastAt: s.last !== undefined ? at(addDays(today, s.last), (s.hour ?? 9) + 1) : null,
      lastDir: s.dir ?? null,
    }
  })
}
