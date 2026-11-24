// DATA CONTOH dari artifact "New WA Inbox". Nama tamu, kode booking, dan isi chat fiktif.
// Jangan diisi data pelanggan sungguhan.
import type {
  AgentEvent, AgentKey, AgentMode, AtItem, AtKey, ChannelKey, Contact, Conv, DaySummary,
  Knowledge, PointKind, Sched, State, Tone,
} from './types'
import { initialTemplates } from './templates'

export const CH: Record<ChannelKey, [string, string]> = {
  wa: ['WhatsApp', '--ch-wa'],
  kl: ['Klook', '--ch-klook'],
  ml: ['Email', '--ch-mail'],
  ig: ['Instagram', '--ch-ig'],
}

export const AGS: Record<AgentKey, [string, string]> = {
  balas: ['Balas pesan', '--ch-wa'],
  poin: ['Update poin penting', '--ch-ig'],
  note: ['Update note', '--ch-mail'],
  ringkas: ['Summarize', '--muted'],
  reminder: ['Reminder ke tamu', '--ch-klook'],
  crew: ['Reminder ke crew', '--good'],
  vendor: ['Reminder ke vendor', '--bad'],
  lead: ['Follow-up lead', '--warn'],
}
export const AGENT_KEYS = Object.keys(AGS) as AgentKey[]

export const MODES: [AgentMode, string][] = [['mati', 'Mati'], ['draf', 'Draf saja'], ['otomatis', 'Otomatis']]

export const AGD: Record<AgentKey, string> = {
  balas: 'Menjawab pesan tamu dari knowledge dan data booking. Draf muncul hanya di chat yang botnya nonaktif',
  poin: 'Memperbarui poin penting setelah ada pesan baru',
  note: 'Menulis note ke booking dari pesan tamu',
  ringkas: 'Meringkas percakapan harian dan saat chat dibuka',
  reminder: 'Mengirim reminder ke tamu berisi link portal: pelunasan, info trip dengan detail jemput, dan pesan trip selesai',
  crew: 'Mengingatkan crew yang diplot sehari sebelum trip: nama tamu, titik dan jam jemput',
  vendor: 'Mengingatkan vendor transport Bali sehari sebelum trip, dan mengabari vendor saat data tamu berubah',
  lead: 'Menghubungi kembali calon tamu yang berhenti membalas setelah tanya harga',
}

export const SRC: Record<AgentKey, [string, string]> = {
  balas: ['Knowledge dan data booking', 'Pertanyaan tamu cocok dengan knowledge yang terbit'],
  poin: ['Transkrip chat 5 sampai 8 pesan terakhir', 'Ada pesan baru setelah ringkasan terakhir'],
  note: ['Pesan tamu yang menyebut data perjalanan', 'Pesan memuat detail jemput atau kaos yang layak dicatat'],
  ringkas: ['Seluruh percakapan hari itu', 'Job harian 00:00 atau chat dibuka setelah ada pesan baru'],
  reminder: ['Jadwal reminder tamu (H-7, H-2, hari terakhir trip)', 'Waktu kirim reminder tamu tiba'],
  crew: ['Plot crew booking dan jadwal H-1', 'Trip dimulai besok; crew perlu tahu tamu, titik dan jam jemput'],
  vendor: ['Booking dengan transport Bali dan perubahan data tamu di portal', 'Trip Bali dimulai besok, atau data yang dipakai vendor berubah'],
  lead: ['Chat calon tamu yang berhenti setelah tanya harga', 'Tidak ada balasan dalam 24 sampai 72 jam'],
}

/** Tugas terjadwal per agent (diambil dari job WhatsApp legacy, 2026-11-24). Agent tanpa entri = berbasis kejadian. */
export const AGT: Partial<Record<AgentKey, [string, string][]>> = {
  reminder: [['Pelunasan', 'H-7 · 15:00'], ['Info trip', 'H-2 · 20:00'], ['Trip selesai', 'Hari terakhir · 15:00']],
  crew: [['Reminder crew', 'H-1 · 10:00']],
  vendor: [['Vendor transport Bali', 'H-1 · 15:15']],
}

export const AST: Record<AgentEvent['s'], [Tone, string]> = {
  ok: ['good', 'Berhasil'],
  gagal: ['bad', 'Gagal'],
  tunggu: ['warn', 'Menunggu'],
  batal: ['neu', 'Dibatalkan'],
}

export const KC: Record<PointKind, Tone> = {
  komplain: 'bad', bayar: 'warn', jemput: 'info', keputusan: 'neu', lokasi: 'neu', trip: 'neu', kebutuhan: 'neu',
}
export const POINT_KINDS = Object.keys(KC) as PointKind[]

export const IFL = ['Semua', 'Belum dibalas', 'Bot', 'Saya', 'Email']
export const FUT = 'Follow-up agent' as const
export const AT_KEYS: AtKey[] = ['Balas', 'Tindak lanjut', 'Janji tim', 'Reminder']
export const ALBL: Partial<Record<AtKey, string>> = { 'Tindak lanjut': 'Follow Up', 'Janji tim': 'Janji Admin' }
/** Urutan hari untuk jadwal follow-up (tunda = geser ke hari berikutnya). */
export const SD = ['Hari ini', 'Besok', '2 hari lagi', '3 hari lagi']

const CV: Conv[] = [
  {
    id: 1, n: 'Sarah M.', ch: 'wa', un: 2, t: '2m', bot: true, lb: 'JVTO', last: 'Also, 4 t-shirts: 2× M and 2× L please',
    msgs: [
      { k: 's', text: 'Hari ini' },
      { k: 'g', text: 'Hi! We land at 05:40, can pickup be 06:30 instead of 07:00?', time: '10:12' },
      { k: 'b', text: 'Hello Sarah, noted. You can update your pickup time and t-shirt sizes yourself here: jvto.me/b/xxxx', time: '10:12', meta: { ag: 'balas', src: 'Aturan: perubahan data lewat portal', why: 'Tamu minta ubah jam jemput dan kaos; perubahan dilakukan tamu di portal' } },
      { k: 's', text: 'Perubahan dilakukan tamu lewat portal' },
      { k: 'g', text: 'Also, 4 t-shirts: 2× M and 2× L please', time: '10:14' },
    ],
    bk: { kode: 'JVTO-xxxx', paket: '3D Bromo · Ijen', tgl: '04–06 Okt', jemput: 'Bandara SUB · 07:00', bayar: ['good', 'Lunas'] },
    rg: ['⏳ Ukuran kaos belum jelas', '⏳ Janji tim: cek jam jemput', '+ 3 poin lain'],
    kt: { tel: '••• 3501', neg: 'Italia', lab: 'Tamu' },
    note: 'Jemput 06:30 (diminta tamu) · Kaos 2× M, 2× L', wait: true,
    dr2: 'Hello Sarah, we have noted your request. To update your pickup time and t-shirt sizes, please use your portal link: jvto.me/b/xxxx',
  },
  {
    id: 2, n: 'Kenji T.', ch: 'kl', un: 0, t: '9m', bot: true, lb: 'KLOOK', last: 'Bot: Your booking is confirmed…',
    msgs: [
      { k: 'g', text: 'Is my booking confirmed?', time: '09:40' },
      { k: 'b', text: 'Your booking is confirmed. Pickup details will arrive 2 days before.', time: '09:40', meta: { ag: 'balas', src: 'Knowledge: Konfirmasi booking', why: 'Pertanyaan konfirmasi booking cocok dengan knowledge' } },
      { k: 'b', text: 'Reminder: please share your drop-off point here: jvto.me/b/xxxx', time: '16:20', meta: { ag: 'reminder', src: 'Jadwal reminder H-5', why: 'Titik antar belum diisi' } },
    ],
    bk: { kode: 'KLOOK-xxxx', paket: '4D3N Ijen · Bromo', tgl: '16–19 Okt', jemput: 'Hotel Surabaya · 07:00', bayar: ['warn', 'DP'] },
    rg: ['✅ Konfirmasi booking dijawab'], kt: { tel: '••• 1204', neg: 'Jepang', lab: 'Tamu' },
  },
  {
    id: 3, n: 'Lukas B.', ch: 'wa', un: 1, t: '14m', bot: false, lb: 'JVTO', last: 'What size t-shirt do we need?',
    msgs: [{ k: 'g', text: 'What size t-shirt do we need?', time: '09:35' }],
    bk: { kode: 'JVTO-xxxx', paket: '3D Bromo · Madakaripura', tgl: '11–13 Okt', jemput: 'Bali · 07:00', bayar: ['good', 'Lunas'] },
    rg: ['⏳ Pertanyaan kaos belum dijawab'], kt: { tel: '••• 7788', neg: 'Jerman', lab: 'Tamu' }, wait: true,
    drs: 'Knowledge: Ukuran kaos',
    dr: 'Hello Lukas, for the t-shirts please choose one size per guest (S, M, L or XL). Just reply with the sizes and we will note them down.',
  },
  {
    id: 4, n: 'Ayu R.', ch: 'ig', un: 0, t: '31m', bot: false, lb: 'NEW', last: 'Terima kasih, sudah sampai hotel',
    msgs: [
      { k: 'g', text: 'Terima kasih, sudah sampai hotel', time: '09:10' },
      { k: 'a', text: 'Sama-sama kak, selamat beristirahat.', time: '09:12' },
    ],
    bk: { kode: '—', paket: '—', tgl: '—', jemput: '—', bayar: ['neu', 'Belum ada'] },
    rg: ['✅ Tidak ada yang tertunda'], kt: { tel: 'IG @ayu.r', neg: 'Indonesia', lab: 'Calon tamu' },
  },
  {
    id: 5, n: 'Mei H.', ch: 'wa', un: 1, t: '1j', bot: false, lb: 'NEW', last: 'Is Ijen open this Friday?',
    msgs: [{ k: 'g', text: 'Is Ijen open this Friday?', time: '08:50' }],
    bk: { kode: 'JVTO-xxxx', paket: '4D Ijen · Tumpak Sewu', tgl: '20–23 Okt', jemput: 'Bandara SUB · 11:00', bayar: ['warn', 'DP'] },
    rg: ['⏳ Status Ijen belum dijawab'], kt: { tel: '••• 4410', neg: 'Singapura', lab: 'Tamu' }, wait: true,
    drs: 'Knowledge: Jam buka Ijen',
    dr: 'Hello Mei, Ijen is generally open every day, but access can close because of gas levels. We will confirm the status for Friday this afternoon.',
  },
  {
    id: 6, n: 'Daniel P.', ch: 'ml', un: 0, t: '2j', bot: false, lb: 'JVTO', last: 'Payment sent, please check',
    msgs: [{ k: 'g', text: 'Payment sent, please check. Attached the receipt.', time: '08:15' }],
    bk: { kode: 'JVTO-xxxx', paket: '3D Ijen · Bromo', tgl: '24–26 Okt', jemput: 'Hotel · 06:00', bayar: ['bad', 'Menunggu'] },
    rg: ['⏳ Cek pembayaran'], kt: { tel: 'daniel@mail.id', neg: 'Spanyol', lab: 'Tamu' }, wait: true,
    drs: 'Knowledge: Konfirmasi pembayaran',
    dr: 'Hello Daniel, thank you for letting us know. We have received your message and will check the payment shortly, then get back to you.',
  },
  {
    id: 7, n: 'Noor V.', ch: 'wa', un: 0, t: '3j', bot: true, lb: 'VENDOR', last: 'Admin: Noted, kami cek dulu',
    msgs: [
      { k: 'g', text: 'Could you resend the pickup details?', time: '07:20' },
      { k: 'a', text: 'Noted, kami cek dulu.', time: '07:25' },
    ],
    bk: { kode: 'JVTO-xxxx', paket: '3D Ijen · Bromo', tgl: '27–29 Okt', jemput: 'Hotel · 06:30', bayar: ['good', 'Lunas'] },
    rg: ['⏳ Tamu diam sejak detail jemput dikirim'], kt: { tel: '••• 2290', neg: 'Belanda', lab: 'Tamu' },
  },
  {
    id: 8, n: 'Elena C.', ch: 'wa', un: 0, t: '5j', bot: true, lb: 'JVTO', last: 'Bot: Reminder: please complete your pickup…',
    msgs: [
      { k: 'g', text: '👍', time: '05:10' },
      { k: 'b', text: 'Reminder: please complete your pickup time and drop-off point here: jvto.me/b/xxxx', time: '08:00', meta: { ag: 'reminder', src: 'Jadwal reminder H-3', why: 'Jam jemput dan titik antar belum diisi' } },
    ],
    bk: { kode: 'JVTO-xxxx', paket: '4D Tumpak Sewu · Bromo', tgl: '02–05 Nov', jemput: 'Bandara SUB · 09:00', bayar: ['warn', 'DP'] },
    rg: ['⏳ Pembayaran akhir belum dikonfirmasi'], kt: { tel: '••• 9012', neg: 'Prancis', lab: 'Tamu' },
    note: 'Minta kamar tanpa asap rokok',
  },
  {
    id: 9, n: 'Jonas O.', ch: 'kl', un: 0, t: '4j', bot: true, lb: 'CREW', last: 'Bot: Here is the meeting point…',
    msgs: [
      { k: 'g', text: 'Where do we meet on day 1?', time: '06:00' },
      { k: 'b', text: 'Here is the meeting point: lobby of your hotel at 07:00.', time: '06:00', meta: { ag: 'balas', src: 'Knowledge: Titik kumpul', why: 'Pertanyaan titik kumpul hari pertama cocok dengan knowledge' } },
    ],
    bk: { kode: 'KLOOK-xxxx', paket: '3D2N Bromo · Ijen', tgl: '09–11 Nov', jemput: 'Hotel Surabaya · 07:00', bayar: ['good', 'Lunas'] },
    rg: ['⏳ Janji: kirim titik kumpul'], kt: { tel: '••• 5531', neg: 'Swedia', lab: 'Tamu' },
  },
  {
    id: 10, n: 'Priya S.', ch: 'wa', un: 0, t: '3hr', bot: false, lb: 'NEW', last: 'Bot: The 4D Bromo + Ijen tour starts at…', lead: true,
    drl: 'Hi Priya, just checking in on your 4-day Bromo + Ijen question. Dates are filling up for November, shall I check availability for you?',
    msgs: [
      { k: 'g', text: 'How much is the 4-day Bromo + Ijen tour for 2 people?', time: '3 hari lalu' },
      { k: 'b', text: 'The 4D Bromo + Ijen tour starts at the price listed here: jvto.me/p/xxxx. Would you like me to check availability?', time: '3 hari lalu', meta: { ag: 'balas', src: 'Knowledge: Harga paket', why: 'Pertanyaan harga cocok dengan knowledge' } },
    ],
    bk: { kode: '—', paket: '—', tgl: '—', jemput: '—', bayar: ['neu', 'Belum ada'] },
    rg: ['⏳ Lead: belum memutuskan, 3 hari tanpa balasan'], kt: { tel: '••• 6620', neg: 'India', lab: 'Calon tamu' },
  },
  {
    id: 11, n: 'Tom W.', ch: 'ig', un: 0, t: '2hr', bot: true, lb: 'NEW', last: 'Bot: Hi Tom, just checking in…', lead: true,
    msgs: [
      { k: 'g', text: 'Hi, how much for Bromo sunrise, 2 people?', time: '2 hari lalu' },
      { k: 'b', text: 'Bromo sunrise tours start at the price listed here: jvto.me/p/xxxx.', time: '2 hari lalu', meta: { ag: 'balas', src: 'Knowledge: Harga paket', why: 'Pertanyaan harga cocok dengan knowledge' } },
      { k: 'b', text: 'Hi Tom, just checking in on your Bromo sunrise question. Happy to check availability for you!', time: '09:05', meta: { ag: 'lead', src: 'Follow-up lead (H+1)', why: 'Tamu tanya harga lalu 24 jam tidak membalas' } },
    ],
    bk: { kode: '—', paket: '—', tgl: '—', jemput: '—', bayar: ['neu', 'Belum ada'] },
    rg: ['⏳ Lead: follow-up terkirim, menunggu balasan'], kt: { tel: 'IG @tom.w', neg: 'Inggris', lab: 'Calon tamu' },
  },
]

const AT: Record<AtKey, AtItem[]> = {
  Balas: [
    { n: 'Sarah M.', d: 'Minta jemput 06:30 dan kaos 2M 2L; bot sudah kirim link portal', w: 'Belum dibalas 2 jam' },
    { n: 'Lukas B.', d: 'Tanya ukuran kaos', w: 'Belum dibalas 14 menit' },
    { n: 'Mei H.', d: 'Tanya status Ijen hari Jumat', w: 'Belum dibalas 1 jam' },
  ],
  'Tindak lanjut': [
    { n: 'Noor V.', d: 'Tamu diam sejak kami kirim detail jemput', w: 'Diam 2 hari' },
    { n: 'Elena C.', d: 'Belum ada konfirmasi pembayaran akhir', w: 'Diam 3 hari' },
  ],
  'Janji tim': [
    { n: 'Sarah M.', d: 'Janji: cek jam jemput dengan tim', w: 'Terbuka sejak 10:12' },
    { n: 'Jonas O.', d: 'Janji: kirim titik kumpul', w: 'Terbuka sejak kemarin' },
  ],
  Reminder: [
    { n: 'Daniel P.', d: 'Cek mutasi pembayaran', w: 'Jatuh tempo hari ini' },
    { n: 'Kenji T.', d: 'Kabari jam pasti jemput', w: 'Besok 08:00' },
  ],
}

const SJ: Sched[] = [
  { d: 'Hari ini', t: '14:00', a: 'reminder', c: 'Noor V.', ti: 'Konfirmasi jam jemput (H-2) lewat link portal' },
  { d: 'Hari ini', t: '16:00', a: 'reminder', c: 'Sarah M.', ti: 'Cek apakah tamu sudah memperbarui data di portal' },
  { d: 'Besok', t: '08:00', a: 'reminder', c: 'Elena C.', ti: 'Pelunasan akhir (H-1) dengan link portal' },
  { d: 'Besok', t: '08:00', a: 'vendor', c: 'Lukas B.', ti: 'Ulangi kabar kaos ke vendor yang gagal tadi' },
  { d: 'Hari ini', t: '20:00', a: 'reminder', c: 'Elena C.', ti: 'Info trip (H-2): jam dan titik jemput, pickup sign' },
  { d: 'Hari ini', t: '15:00', a: 'reminder', c: 'Mei H.', ti: 'Pelunasan (H-7): sisa bayar dan link kartu/QRIS' },
  { d: 'Hari ini', t: '15:15', a: 'vendor', c: 'Lukas B.', ti: 'Vendor transport Bali (H-1): unit, jemput, antar Ketapang' },
  { d: 'Besok', t: '10:00', a: 'crew', c: 'Elena C.', ti: 'Reminder crew (H-1): tamu, titik dan jam jemput' },
  { d: 'Besok', t: '15:00', a: 'reminder', c: 'Jonas O.', ti: 'Trip selesai: terima kasih dan link portal' },
  { d: 'Besok', t: '09:00', a: 'reminder', c: 'Kenji T.', ti: 'Lengkapi titik antar (H-3)' },
  { d: '2 hari lagi', t: '08:00', a: 'reminder', c: 'Mei H.', ti: 'Tanyakan data jemput (H-5)' },
  { d: 'Hari ini', t: '17:00', a: 'lead', c: 'Priya S.', ti: 'Follow-up lead: tanya harga 4D Bromo + Ijen, 3 hari tanpa balasan' },
  { d: '2 hari lagi', t: '10:00', a: 'lead', c: 'Tom W.', ti: 'Follow-up lead kedua bila belum membalas' },
]

export const RD: Record<string, DaySummary> = {
  'Hari ini': {
    t: 'Dibuat 00:00 · diperbarui 10:15', a: 9, j: 2,
    p: [
      ['komplain', 'Lukas B.', 'Jemput hari kedua terlambat 30 menit; tamu meminta kompensasi'],
      ['jemput', 'Sarah M.', 'Minta jemput 06:30; tamu memperbarui sendiri lewat portal'],
      ['kebutuhan', 'Sarah M.', 'Kaos 4 buah: 2× M, 2× L'],
      ['bayar', 'Daniel P.', 'Bukti transfer dikirim, mutasi belum dicek'],
      ['keputusan', 'Noor V.', 'Menimbang menambah Ijen, menunggu harga dari tim'],
      ['lokasi', 'Jonas O.', 'Titik kumpul hari pertama di lobi hotel, 07:00'],
      ['trip', 'Mei H.', 'Menanyakan status Ijen hari Jumat'],
    ],
  },
  Kemarin: {
    t: 'Dibuat 00:00 · tidak diperbarui lagi', a: 12, j: 1,
    p: [
      ['bayar', 'Elena C.', 'Pelunasan dijanjikan sebelum keberangkatan'],
      ['jemput', 'Kenji T.', 'Jemput di hotel Surabaya, 07:00, sudah dikonfirmasi'],
      ['kebutuhan', 'Ayu R.', 'Meminta kamar hotel tanpa asap rokok'],
      ['trip', 'Lukas B.', 'Memastikan itinerary hari pertama'],
      ['keputusan', 'Mei H.', 'Memilih paket 4 hari dibanding 3 hari'],
    ],
  },
  '2 hari lalu': {
    t: 'Dibuat 00:00 · tidak diperbarui lagi', a: 8, j: 0,
    p: [
      ['keputusan', 'Noor V.', 'Memilih menambah Madakaripura'],
      ['bayar', 'Sarah M.', 'DP 30% diterima'],
    ],
  },
}

export const KT: Contact[] = [
  { n: 'Sarah M.', ch: 'WhatsApp', lab: 'Tamu', kode: 'JVTO-xxxx', last: '2 menit lalu', ringkas: '4 pax, jemput bandara SUB' },
  { n: 'Kenji T.', ch: 'Klook', lab: 'Tamu', kode: 'KLOOK-xxxx', last: '9 menit lalu', ringkas: '6 pax, hotel Surabaya' },
  { n: 'Lukas B.', ch: 'WhatsApp', lab: 'Tamu', kode: 'JVTO-xxxx', last: '14 menit lalu', ringkas: '2 pax' },
  { n: 'Ayu R.', ch: 'Instagram', lab: 'Calon tamu', kode: '—', last: '31 menit lalu', ringkas: 'Belum ada booking' },
  { n: 'Mei H.', ch: 'WhatsApp', lab: 'Tamu', kode: 'JVTO-xxxx', last: '1 jam lalu', ringkas: '3 pax' },
  { n: 'Daniel P.', ch: 'Email', lab: 'Tamu', kode: 'JVTO-xxxx', last: '2 jam lalu', ringkas: 'Menunggu pembayaran' },
  { n: 'Vendor Transport Bali', ch: 'WhatsApp', lab: 'Mitra', kode: '—', last: 'kemarin', ringkas: 'Transport Bali' },
  { n: 'Noor V.', ch: 'WhatsApp', lab: 'Tamu', kode: 'JVTO-xxxx', last: '3 jam lalu', ringkas: '2 pax' },
  { n: 'Elena C.', ch: 'WhatsApp', lab: 'Tamu', kode: 'JVTO-xxxx', last: '5 jam lalu', ringkas: '4 pax' },
  { n: 'Jonas O.', ch: 'Klook', lab: 'Tamu', kode: 'KLOOK-xxxx', last: '4 jam lalu', ringkas: '3 pax' },
  { n: 'Priya S.', ch: 'WhatsApp', lab: 'Calon tamu', kode: '—', last: '3 hari lalu', ringkas: 'Tanya paket 4D Bromo + Ijen' },
  { n: 'Tom W.', ch: 'Instagram', lab: 'Calon tamu', kode: '—', last: '2 hari lalu', ringkas: 'Tanya Bromo sunrise' },
]

const KN: Knowledge[] = [
  { title: 'Harga paket Bromo', status: 'PUBLISHED', ver: 'v4' },
  { title: 'Jam buka Ijen', status: 'PUBLISHED', ver: 'v2' },
  { title: 'Aturan refund', status: 'DRAFT', ver: 'v1' },
  { title: 'Titik kumpul Surabaya', status: 'PUBLISHED', ver: 'v3' },
]

export const LG: [string, string, string][] = [
  ['Keputusan', 'Sarah M. · jawaban dari knowledge "Jam buka Ijen"', '10:12'],
  ['Alur', 'Pesan masuk → klasifikasi → knowledge → balas', '10:12'],
  ['Audit', 'Admin mengubah fallbackReply', 'kemarin'],
  ['Keputusan', 'Lukas B. · diserahkan ke manusia (pertanyaan kaos)', '09:35'],
  ['Aturan', 'Registry aturan bot (baca saja)', '—'],
]

const AE: AgentEvent[] = [
  { d: 'Hari ini', t: '10:14', a: 'balas', c: 'Sarah M.', s: 'ok', ti: 'Membalas pertanyaan jam jemput', i: 'Pesan tamu: "Can we change pickup to 06:30 instead of 07:00?"', o: 'Balasan berisi link portal: "Hello Sarah, noted. You can update your pickup time and t-shirt sizes yourself here: jvto.me/b/xxxx"', r: false, h: { k: 'msg', m: 'Hello Sarah, noted' } },
  { d: 'Hari ini', t: '10:14', a: 'poin', c: 'Sarah M.', s: 'ok', ti: 'Poin penting diperbarui: jemput dan kebutuhan', i: 'Transkrip 5 pesan terakhir', o: 'jemput: 07:00 → 06:30 diminta · kebutuhan: kaos 2× M, 2× L', r: false, h: { k: 'poin', day: 'Hari ini', kind: 'jemput', n: 'Sarah M.' } },
  { d: 'Hari ini', t: '10:13', a: 'reminder', c: 'Sarah M.', s: 'ok', ti: 'Link portal terkirim: tamu minta ubah jemput dan kaos', i: 'Pesan tamu: jemput 06:30, kaos 2× M, 2× L', o: 'Link portal dikirim otomatis; tamu memperbarui sendiri', r: false, h: { k: 'msg', m: 'You can update your pickup time' } },
  { d: 'Hari ini', t: '10:12', a: 'note', c: 'Sarah M.', s: 'ok', ti: 'Note ditulis ke booking', i: 'Pesan tamu tentang jemput dan kaos', o: 'Note: "Jemput 06:30 (diminta tamu) · Kaos 2× M, 2× L"', r: false, h: { k: 'note' } },
  { d: 'Hari ini', t: '10:00', a: 'crew', c: 'Lukas B.', s: 'ok', ti: 'Reminder crew (H-1): 2 crew + grup crew', i: 'Plot crew: driver dan guide Ijen; jemput Bali 07:00', o: 'Template crew_reminder_personal terkirim ke 2 crew, crew_reminder_group ke grup crew', r: false, h: { k: 'out', m: 'Reminder crew' } },
  { d: 'Hari ini', t: '09:40', a: 'balas', c: 'Kenji T.', s: 'ok', ti: 'Membalas konfirmasi booking', i: 'Pesan tamu: "Is my booking confirmed?"', o: 'Balasan: "Your booking is confirmed. Pickup details will arrive 2 days before."', r: false, h: { k: 'msg', m: 'Your booking is confirmed' } },
  { d: 'Hari ini', t: '09:36', a: 'vendor', c: 'Lukas B.', s: 'gagal', ti: 'Kabar perubahan kaos ke vendor', i: 'Tamu memperbarui kaos di portal: 2× M, 2× L (pesan ke vendor tanpa nama tamu)', o: 'Gagal: penyedia menolak pengiriman template. Vendor belum tahu.', r: false, h: { k: 'out', m: 'Kabar kaos' } },
  { d: 'Hari ini', t: '09:35', a: 'balas', c: 'Lukas B.', s: 'ok', ti: 'Menyerahkan chat ke tim', i: 'Pesan tamu: "What size t-shirt do we need?"', o: 'Pertanyaan di luar knowledge; chat dialihkan ke Antrean Balas', r: false, h: { k: 'antrean', tab: 'Balas', n: 'Lukas B.' }, src: 'Knowledge: tidak ada yang cocok', why: 'Pertanyaan di luar knowledge, jadi agent menyerahkan chat ke tim dan menyiapkan draf balasan' },
  { d: 'Hari ini', t: '09:05', a: 'lead', c: 'Tom W.', s: 'ok', ti: 'Follow-up lead terkirim: tanya harga Bromo sunrise (H+1)', i: 'Tamu tanya harga lalu 24 jam tidak membalas', o: 'Pesan Instagram terkirim 09:05; menunggu balasan tamu', r: false, h: { k: 'msg', m: 'Hi Tom, just checking in' } },
  { d: 'Hari ini', t: '08:00', a: 'reminder', c: 'Elena C.', s: 'ok', ti: 'Reminder ke tamu: lengkapi data jemput (H-3)', i: 'Butir yang kurang: jam jemput, titik antar', o: 'Pesan WhatsApp berisi link portal terkirim 08:00', r: false, h: { k: 'msg', m: 'Reminder: please complete' } },
  { d: 'Hari ini', t: '08:00', a: 'reminder', c: 'Noor V.', s: 'gagal', ti: 'Reminder ke tamu: konfirmasi jam jemput (H-2)', i: 'Butir yang kurang: jam jemput', o: 'Tidak dikirim: jendela WhatsApp 24 jam tertutup. Hubungi manual.', r: false, h: { k: 'antrean', tab: 'Tindak lanjut', n: 'Noor V.' } },
  { d: 'Hari ini', t: '07:30', a: 'ringkas', c: 'Mei H.', s: 'ok', ti: 'Ringkasan chat diperbarui', i: 'Chat dibuka setelah ada pesan baru', o: '1 pertanyaan belum terjawab: status Ijen hari Jumat', r: false, h: { k: 'ring' } },
  { d: 'Hari ini', t: '00:20', a: 'vendor', c: 'Daniel P.', s: 'ok', ti: 'Kabar perubahan jemput ke vendor Bali', i: 'Tamu mengubah titik jemput di portal; booking transport Bali', o: 'Template internal terkirim; jam ditulis "jam belum ada"', r: false, h: { k: 'out', m: 'Kabar jemput ke vendor Bali' } },
  { d: 'Hari ini', t: '00:00', a: 'ringkas', c: 'Semua percakapan', s: 'ok', ti: 'Ringkasan harian dibuat', i: '9 percakapan aktif kemarin', o: '7 poin penting, 2 janji tim, 9 item masuk Antrean', r: false, h: { k: 'poin', day: 'Hari ini', kind: 'Semua' } },
  { d: 'Kemarin', t: '20:00', a: 'reminder', c: 'Noor V.', s: 'ok', ti: 'Info trip (H-2): detail jemput hotel', i: 'Jadwal info trip H-2 20:00; jemput hotel 06:30', o: 'Template trip_information_hotel terkirim dengan gambar pickup sign', r: false, h: { k: 'out', m: 'Info trip' } },
  { d: 'Kemarin', t: '15:15', a: 'vendor', c: 'Lukas B.', s: 'ok', ti: 'Vendor transport Bali (H-1): Elf Short, 4 pax', i: 'Trip mulai Bali besok; jemput hotel Bali 07:00', o: 'Template internal_bali_transport_reminder terkirim ke vendor (tanpa nomor tamu)', r: false, h: { k: 'out', m: 'Vendor transport Bali' } },
  { d: 'Kemarin', t: '15:00', a: 'reminder', c: 'Daniel P.', s: 'ok', ti: 'Pelunasan (H-7): sisa bayar dan link kartu/QRIS', i: 'Sisa bayar belum lunas; batas kartu H-5, transfer H-3', o: 'Template payment_reminder_balance terkirim dengan link pembayaran baru', r: false, h: { k: 'out', m: 'Pelunasan' } },
  { d: 'Kemarin', t: '21:10', a: 'balas', c: 'Ayu R.', s: 'ok', ti: 'Membalas ucapan terima kasih', i: 'Pesan tamu: "Terima kasih, sudah sampai hotel"', o: 'Chat ditandai selesai, tidak ada balasan dikirim', r: false, h: { k: 'msg', m: 'Terima kasih, sudah sampai hotel' } },
  { d: 'Kemarin', t: '18:45', a: 'note', c: 'Elena C.', s: 'ok', ti: 'Note ditulis ke booking', i: 'Pesan tamu tentang kamar hotel', o: 'Note: "Minta kamar tanpa asap rokok"', r: false, h: { k: 'note' } },
  { d: 'Kemarin', t: '16:20', a: 'reminder', c: 'Kenji T.', s: 'ok', ti: 'Reminder ke tamu: lengkapi data jemput (H-5)', i: 'Butir yang kurang: titik antar', o: 'Pesan WhatsApp berisi link portal terkirim 16:20', r: false, h: { k: 'msg', m: 'Reminder: please share your drop-off' } },
  { d: 'Kemarin', t: '14:02', a: 'vendor', c: 'Lukas B.', s: 'ok', ti: 'Kabar kaos ke vendor', i: 'Tamu memperbarui kaos di portal: 4 buah', o: 'Template internal terkirim', r: false, h: { k: 'out', m: 'Kabar kaos' } },
  { d: 'Kemarin', t: '12:30', a: 'poin', c: 'Mei H.', s: 'ok', ti: 'Poin penting diperbarui: keputusan', i: 'Transkrip 8 pesan terakhir', o: 'keputusan: memilih paket 4 hari', r: false, h: { k: 'poin', day: 'Kemarin', kind: 'keputusan', n: 'Mei H.' } },
  { d: 'Kemarin', t: '09:15', a: 'reminder', c: 'Kenji T.', s: 'ok', ti: 'Link portal terkirim: tamu memperbarui jam jemput', i: 'Reminder H-5 berisi link portal jvto.me/b/xxxx', o: 'Tamu memperbarui jam jemput 07:00 sendiri di portal', r: false, h: { k: 'booking' } },
]

export function initialState(): State {
  return structuredClone({
    cv: CV,
    at: AT,
    sj: SJ,
    ae: AE,
    agm: { balas: 'otomatis', poin: 'otomatis', note: 'otomatis', ringkas: 'otomatis', reminder: 'otomatis', crew: 'otomatis', vendor: 'otomatis', lead: 'draf' },
    agst: { balas: { ok: 41, bad: 4 }, poin: { ok: 30, bad: 2 }, note: { ok: 18, bad: 1 }, ringkas: { ok: 22, bad: 1 }, reminder: { ok: 27, bad: 0 }, crew: { ok: 14, bad: 0 }, vendor: { ok: 12, bad: 1 }, lead: { ok: 9, bad: 2 } },
    lead: { dikirim: 11, booking: 3 },
    pause: false,
    kn: KN,
    gap: ['Apakah Ijen buka saat hujan?', 'Boleh membawa drone di Bromo?', 'Ada diskon rombongan 12 orang?'],
    bs: { auto: true, skip: true, hand: true, fb: 'Maaf, kami cek dulu dan segera kembali ke Anda.', hr: 'Kami teruskan ke tim kami, mohon tunggu sebentar.' },
    icv: 1, ifl: 'Semua', itab: 'Booking',
    atab: 'Balas', sjag: 'Semua', sjday: 'Semua',
    rday: 'Hari ini', rkind: 'Semua', rregen: 0, rtab: 'poin',
    aday: 'Hari ini', aag: 'Semua', ast: 'Semua', aq: '',
    kq: '', kl: '',
    tpl: initialTemplates(), tcat: 'Semua', tq: '',
    btab: 'Perilaku', lf: 'Semua',
  } satisfies State)
}
