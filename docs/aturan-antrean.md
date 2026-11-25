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
| AQ-12 | Selama AI belum menilai, dipakai saringan kata: pesan penutup murni tidak masuk; pesan bertanda tanya, jawaban atas pertanyaan admin, dan "yes/ya" tetap masuk. | `isNoiseMessage` |
| AQ-13 | Pesan tanpa isi (AQ-10) tidak memindahkan Follow Up atau Janji Admin menjadi Balas. | `CONTENT_MESSAGE_WHERE` |

## Follow Up

| ID | Aturan | Kode alasan |
|---|---|---|
| AQ-20 | Mitra (Klook, vendor, hotel) bukan Follow Up lead. Pesan mitra tetap bisa masuk Balas atau Janji Admin. | `MITRA_BUKAN_FOLLOW_UP` |
| AQ-21 | Percakapan yang menurut AI sudah selesai tidak masuk Follow Up maupun Janji Admin. | `PERCAKAPAN_SELESAI` |
| AQ-22 | Tamu yang memilih operator lain tidak masuk Follow Up maupun Janji Admin. | `PILIH_OPERATOR_LAIN` |
| AQ-23 | Tamu yang trip-nya sudah selesai tidak masuk Follow Up maupun Janji Admin, kecuali AI melihat potensi booking baru. Tamu lama yang datanya sudah dicek tapi tanpa booking aktif juga dihitung trip selesai, karena pencarian booking hanya melihat trip sejak awal bulan lalu. | `TRIP_SELESAI` |
| AQ-24 | Calon tamu tanpa booking yang tanggal trip mintaannya sudah lewat tidak masuk Follow Up maupun Janji Admin. Bila tamu hanya menyebut bulan, batasnya akhir bulan itu. Bila tahun tidak disebut, tanggal tidak pernah dianggap sebelum percakapan dimulai (tahunnya dimajukan). | `TANGGAL_TRIP_LEWAT` (`tanggalTripSelesai`, `tripEndDay`) |
| AQ-25 | Follow Up yang ternyata tim masih berutang (janji belum ditepati, pertanyaan tamu belum dijawab tuntas, info yang dijanjikan belum dikirim) dipindah ke Janji Admin, kecuali pesan admin terakhir meminta jawaban tamu. Bila utangnya beres, ia kembali ke Follow Up. | `followUpOwedByTeam`, catatan "Pindahan Follow Up: tim masih berutang" |

## Janji Admin

| ID | Aturan | Kode alasan |
|---|---|---|
| AQ-30 | Hanya janji yang diucapkan admin (manusia). Ucapan bot seperti "let me check with our team" bukan janji tim. | `botIds` di `parseReview` |
| AQ-31 | Bukan janji: tawaran bersyarat ("kalau mau…", "bila…"), pernyataan kemampuan ("tim dapat…", "bisa…"), arahan ke tamu ("silakan booking lewat link"), dan sesuatu yang sudah dilakukan di pesan yang sama. | `notAPromise` |
| AQ-32 | Admin yang menulis "here is the price" / "berikut harganya" disertai gambar atau dokumen dianggap sudah mengirimnya: janjinya terpenuhi. | penanda `[image]` di transkrip |
| AQ-33 | Janji yang sudah ditanggapi admin dengan pertanyaan atau permintaan konfirmasi ke tamu ("Just to confirm…", "please let me know", "mohon konfirmasi"), dan tamu belum menjawab, pindah ke Follow Up. Pesan janji itu sendiri boleh jadi pertanyaannya. Tanda tanya di dalam tautan tidak dihitung. | `promiseAwaitingGuest`, `ASKS_GUEST` |
| AQ-34 | Balasan admin tanpa pertanyaan ("refund sedang kami proses") tidak menutup janji. Janji tertutup bila AI menilai semua janjinya ditepati, atau tim menekan Lepas. | `PROMISE_KEPT` |

## Ringkasan malam

| ID | Aturan | Kode alasan |
|---|---|---|
| AQ-40 | Job pukul 00.00 tidak meringkas ulang chat yang tidak punya pesan baru sejak ringkasan terakhirnya. Ringkasan lama dipakai apa adanya dan tidak tercatat sebagai pembaruan. Tombol "Buat ulang" admin tetap meringkas ulang semuanya. | `reusableReview` |
