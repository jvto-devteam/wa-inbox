# Aturan Antrean

Aturan yang menentukan sebuah chat masuk **Balas**, **Follow Up**, **Janji Admin**, atau **tidak masuk antrean
sama sekali**. Ini satu-satunya sumber aturan. Setiap aturan ditetapkan owner (25 November 2026, dari audit isi
Antrean) dan sudah dijalankan oleh kode. Tes `src/lib/summary-items/rulebook.test.ts` gagal bila kode dan dokumen ini
tidak cocok, jadi aturan tidak bisa berubah diam-diam.

Kode sumber: `src/lib/summary-items/exclusion.ts` (penyaring), `src/lib/summary-items/sync.ts` (pembuatan item),
`src/lib/daily-summary/review.ts` (ringkasan AI yang menjadi bahan penilaian).

## Jenis antrean

| Antrean | Arti | Kapan muncul |
|---|---|---|
| **Balas** | Tamu menunggu jawaban tim | Pesan terakhir dari tamu, berisi, dan menurut AI perlu dibalas |
| **Follow Up** | Bola di tamu: tim sudah menawarkan atau bertanya, tamu diam | Pesan terakhir dari tim, calon tamu belum booking |
| **Janji Admin** | Tim berutang sesuatu ke tamu | Admin berjanji dan belum menepati, atau permintaan tamu belum dijawab tuntas |
| **Reminder** | Pengingat yang dijadwalkan tim | Hasil tombol Ingatkan, atau "Ingatkan follow-up" di Laporan |
| **Jadwal agent** | Reminder WhatsApp yang akan dikirim sistem booking | Salinan jadwal backoffice, hanya dibaca |

## Prinsip

Makna pesan (apakah bertanya, apakah janji, apakah perlu dibalas, kapan trip-nya) dinilai **AI** lewat isian ringkasan
yang sudah berjalan, bukan daftar kata, karena pesan tamu dan admin beragam bahasa dan susunan. Kode hanya memakai data
terstruktur: jenis pesan dari WhatsApp, platform, nomor, data booking, waktu pesan. Satu pengecualian, AQ-12, adalah
cadangan sementara sampai AI menilai.

## Kriteria layak (standar)

Sebuah chat **layak** masuk antrean hanya bila memenuhi SEMUA kriteria jenisnya. Setiap kriteria dijaga oleh aturan
AQ di bawah; yang gagal ditutup otomatis setiap 5 menit.

| Antrean | Layak bila | Dijaga oleh |
|---|---|---|
| Semua | Chat WhatsApp, nomor luar negeri, bukan percakapan uji, kontak tamu atau mitra | AQ-01, AQ-02, AQ-03, AQ-04 |
| **Balas** | Pesan berisi terakhir datang dari tamu, dan menurut AI pesan itu menunggu jawaban tim. Calon tamu tanpa booking: tanggal mulai trip belum lewat (atau belum diketahui). | AQ-10, AQ-11, AQ-12, AQ-24 |
| **Follow Up** | Calon tamu (bukan mitra). Pesan terakhir dari tim, berisi penawaran atau pertanyaan. Tamu diam. Tim tidak sedang berutang. Percakapan belum selesai. Tamu tidak memilih operator lain atau open trip. Tanggal mulai trip belum lewat (atau belum diketahui). | AQ-20 s.d. AQ-25 |
| **Janji Admin** | Ada janji tertulis dari ADMIN yang belum ditepati, atau permintaan tamu yang belum dijawab tuntas. Janji itu tidak bersyarat pada langkah tamu. Rentetan balasan admin sesudahnya tidak bertanya balik ke tamu. Tanggal mulai trip belum lewat (atau belum diketahui). Percakapan belum selesai. | AQ-21 s.d. AQ-24, AQ-30 s.d. AQ-34 |

## Audit

`npm run audit:antrean` (skrip `scripts/audit-antrean.ts`, hanya membaca) menilai setiap item terbuka:
**LAYAK**, **TIDAK LAYAK** (melanggar aturan AQ; seharusnya nol karena tick menutupnya, keluar dengan kode 1 bila ada),
atau **PERLU DICEK** bila data AI belum cukup untuk memutuskan:

| Tanda | Arti |
|---|---|
| `TANPA_RINGKASAN` | Percakapan belum pernah diringkas AI |
| `TANGGAL_TRIP_BELUM_DIKETAHUI` | Calon tamu belum menyebut kapan trip-nya; aturan AQ-24 belum bisa dipakai |
| `HANYA_DIBALAS_BOT` | Belum pernah ada balasan admin di percakapan ini |
| `JANJI_TIDAK_TERCATAT_DI_RINGKASAN` | Kartu Janji Admin yang ringkasan terbarunya tidak lagi mencatat utang tim |

## Bahan penilaian

Penilaian memakai **ringkasan AI terbaru** percakapan itu. Ringkasan dibuat ulang setiap ada pesan baru, setiap pukul
00.00 bila ada pesan baru sejak ringkasan terakhir, dan saat tombol "Perbarui sekarang". Isian yang dipakai antrean:
status percakapan, jenis kontak, janji tim, alasan belum booking, `perluBalas`, dan `tanggalTripSelesai`.

## Aturan umum (berlaku untuk semua antrean)

| ID | Aturan | Kode alasan |
|---|---|---|
| AQ-01 | Hanya chat WhatsApp. Instagram, Facebook, dan Email tidak masuk. | `BUKAN_WHATSAPP` |
| AQ-02 | Nomor Indonesia tidak masuk. | `NOMOR_INDONESIA` |
| AQ-03 | Percakapan uji (sandbox) tidak masuk. | `PERCAKAPAN_UJI` |
| AQ-04 | Kontak yang menurut AI bukan tamu maupun mitra (sales, salah sambung, uji coba) tidak masuk. | `BUKAN_TAMU` |
| AQ-05 | Tidak ada batas umur. Lead lama tetap di antrean sampai salah satu aturan lain menutupnya. | — |
| AQ-06 | Item yang sudah dijadwalkan tim lewat Ingatkan tidak disentuh aturan apa pun. | — |
| AQ-07 | Item yang tidak masuk ditutup dengan status "tidak masuk antrean" dan alasannya dicatat. Ia dibuka lagi bila tamu mengirim pesan berisi yang baru. | `NOT_QUEUED` |

## Balas

| ID | Aturan | Kode alasan |
|---|---|---|
| AQ-10 | Pesan tanpa isi tidak masuk: reaction, stiker, pesan yang diedit, pesan yang tidak didukung, pesan sistem, lampiran Instagram (story_mention, ig_post). Pesan yang dihapus tamu (revoke) membatalkan pesan berisi terakhir sebelumnya. Foto, dokumen, voice note, video, lokasi, dan kontak tetap dihitung isi. | `HANYA_REAKSI` (`contentlessRun`, `NON_CONTENT_TYPES`) |
| AQ-11 | Bila ringkasan AI yang dibuat SESUDAH pesan terakhir tamu menilai pesan itu tidak perlu dibalas ("ok", "correct", "great", "thanks", emoji), chat tidak masuk. | `TIDAK_PERLU_BALAS` (`reviewSaysNoReply`, `perluBalas`) |
| AQ-12 | CADANGAN, hanya selama AI belum menilai pesan itu (tick 5 menit tidak memanggil AI): saringan kata untuk penutup murni ("ok", "thanks", emoji). Begitu ringkasan AI ada, AQ-11 yang berlaku. Ini satu-satunya aturan berbasis kata untuk makna pesan. | `isNoiseMessage` |
| AQ-13 | Pesan tanpa isi (AQ-10) tidak memindahkan Follow Up atau Janji Admin menjadi Balas. | `CONTENT_MESSAGE_WHERE` |

## Follow Up

| ID | Aturan | Kode alasan |
|---|---|---|
| AQ-20 | Mitra (Klook, vendor, hotel) bukan Follow Up lead. Pesan mitra tetap bisa masuk Balas atau Janji Admin. | `MITRA_BUKAN_FOLLOW_UP` |
| AQ-21 | Percakapan yang menurut AI sudah selesai tidak masuk Follow Up maupun Janji Admin. | `PERCAKAPAN_SELESAI` |
| AQ-22 | Tamu yang memilih operator lain, atau calon tamu yang mencari open trip/group tour (JVTO hanya tur privat), tidak masuk Follow Up maupun Janji Admin. | `PILIH_OPERATOR_LAIN` (label profil `open_trip`) |
| AQ-23 | Tamu yang trip-nya sudah selesai tidak masuk Follow Up maupun Janji Admin, kecuali AI melihat potensi booking baru. Tamu lama yang datanya sudah dicek tapi tanpa booking aktif juga dihitung trip selesai, karena pencarian booking hanya melihat trip sejak awal bulan lalu. | `TRIP_SELESAI` |
| AQ-24 | Calon tamu tanpa booking yang tanggal MULAI trip mintaannya sudah lewat tidak masuk antrean mana pun, termasuk Balas (lead yang belum booking sampai trip mulai sudah tidak bisa dikejar). Tamu yang sudah booking tidak terkena aturan ini; bila tanggal mulai tidak diketahui, dipakai tanggal selesai. Tanggal relatif ("besok", "next 3 days", "this weekend", "sedang menginap di lokasi") dihitung dari tanggal pesannya. Bila tamu hanya menyebut bulan, batasnya akhir bulan itu. Bila tahun tidak disebut, tanggal tidak pernah dianggap sebelum percakapan dimulai (tahunnya dimajukan). | `TANGGAL_TRIP_LEWAT` (`tanggalTripMulai`, `tanggalTripSelesai`, `tripStartDay`, `tripEndDay`) |
| AQ-25 | Follow Up yang ternyata tim masih berutang (janji belum ditepati, pertanyaan tamu belum dijawab tuntas, info yang dijanjikan belum dikirim) dipindah ke Janji Admin, kecuali pesan admin terakhir meminta jawaban tamu. Bila utangnya beres, ia kembali ke Follow Up. | `followUpOwedByTeam`, catatan "Pindahan Follow Up: tim masih berutang" |

## Janji Admin

| ID | Aturan | Kode alasan |
|---|---|---|
| AQ-30 | Hanya janji yang diucapkan admin (manusia). Ucapan bot seperti "let me check with our team" bukan janji tim. | `botIds` di `parseReview` |
| AQ-31 | AI memberi setiap ucapan tim satu jenis: janji, tawaran bersyarat ("kalau mau…", "setelah tanggal diketahui"), pernyataan kemampuan ("tim dapat…"), arahan ke tamu ("silakan booking lewat link"), atau sudah dilakukan. Hanya jenis janji yang dihitung utang tim. Penilaiannya oleh AI dalam bahasa apa pun, bukan daftar kata. | `PROMISE_KINDS` |
| AQ-32 | Admin yang menulis "here is the price" / "berikut harganya" disertai gambar atau dokumen dianggap sudah mengirimnya: janjinya terpenuhi. | penanda `[image]` di transkrip |
| AQ-33 | Bila ringkasan AI yang dibuat SESUDAH pesan terakhir menilai rentetan pesan tim terakhir meminta jawaban, konfirmasi, pilihan, atau data dari tamu (langkah berikutnya ada di tamu), Janji Admin pindah ke Follow Up dan Follow Up tidak dipindah ke Janji Admin. Penilaian AI, bukan daftar kata. | `menungguTamu`, `reviewSaysAwaitingGuest`, `promiseAwaitingGuest` |
| AQ-34 | Balasan admin tanpa pertanyaan ("refund sedang kami proses") tidak menutup janji. Janji tertutup bila AI menilai semua janjinya ditepati, atau tim menekan Lepas. | `PROMISE_KEPT` |

## Ringkasan malam

| ID | Aturan | Kode alasan |
|---|---|---|
| AQ-41 | Pesan panjang dikirim ke AI sampai 2.000 huruf. Yang lebih panjang dipotong dengan penanda "…[dipotong]", dan AI diberi tahu bagian yang terpotong bukan berarti belum dikirim. | `TRANSCRIPT_MAX_CHARS_PER_MESSAGE`, `TRANSCRIPT_CUT_MARK` |
| AQ-40 | Job pukul 00.00 tidak meringkas ulang chat yang tidak punya pesan baru sejak ringkasan terakhirnya. Ringkasan lama dipakai apa adanya dan tidak tercatat sebagai pembaruan. Tombol "Buat ulang" admin tetap meringkas ulang semuanya. | `reusableReview` |
