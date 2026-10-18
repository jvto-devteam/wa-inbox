# Summary Harian → Antrean tindakan

Disetujui operator di chat 2026-10-18.

## Kenapa

Bos meminta Summary Harian tidak "nice to have": data tidak boleh berhenti di halaman, setiap
item harus berujung pada tindakan. Sebelum perubahan ini, `/summary` adalah foto beku
(payload JSON per hari) dengan 6 tab bacaan. Satu-satunya aksinya adalah tautan ke Inbox, tidak
ada status per item, dan item yang sudah dibalas tetap tampil sampai ringkasan dibuat ulang.

## Aturan inti

Setiap item hanya punya tiga jalan keluar:
1. **Ditangani**: ditutup otomatis. Item REPLY tertutup saat ada pesan keluar sesudah pesan
   pemicunya. Item FOLLOW_UP berubah jadi REPLY saat pelanggan kembali chat.
2. **Dijadwalkan**: tombol "Ingatkan" membuat `Reminder` (model yang sudah ada) dan item
   berstatus SCHEDULED. Saat jatuh tempo, item terbuka lagi. Kalau reminder ditandai selesai
   di panel kontak, item ikut selesai.
3. **Dilepas**: tombol "Lepas" dengan catatan opsional. Siapa dan kapan dicatat.

Item yang belum tertutup **terbawa** ke hari berikutnya. Satu baris per percakapan, tidak
terikat tanggal.

## Yang masuk

- Tabel `SummaryItem` (aditif).
- Sinkronisasi dari payload saat generate. Rekonsiliasi (tutup otomatis, jatuh tempo) di tick
  cron `POST /api/outbound-jobs/process` dan saat daftar dibaca.
- API daftar, jumlah, jadwalkan, dan lepas.
- Halaman `/summary` menjadi satu antrean: item terbuka (Balas / Follow up), dengan label
  "Handoff" / "Lead baru" di kartu dan ringkasan LLM (topik, alasan → langkah berikut) di dalam
  kartu. Grup "Dijadwalkan" terpisah. Satu baris "N gap knowledge terbuka →". Tombol admin
  "Buat ulang" tetap.
- Angka item terbuka di menu "Summary Harian" (AppRail).

## Yang sengaja dibuang (keputusan operator)

- Tab Handoff, Gap knowledge, Lead baru, dan Ringkasan percakapan. 4 kartu statistik.
  Pemilih tanggal.
- Usulan perubahan data dari LLM. Stage sudah dinaikkan dari data booking asli
  (`advancePipelineStagesFromBooking`), dan trip brief diisi bot.
- Ringkasan pagi ke WA, assign agen, dan draft AI follow-up.

## Batasan

- Tidak ada pesan otomatis ke pelanggan. Tidak ada lapisan approval. Tidak menulis ke
  new-backoffice.
- Mutasi hanya butuh login (`getSession`), bukan `hasAdminPowers`. Menjadwalkan follow-up dan
  melepas item adalah pekerjaan agen yang setara dengan membalas chat, bukan konfigurasi bot.
  Tidak masuk `BotControlAuditLog` karena tidak mengubah apa yang bot lakukan.
- Baris DONE/DROPPED dipangkas setelah 30 hari (`RETENTION_MS`), konsisten dengan keputusan
  owner 2026-09-22, karena memuat cuplikan chat.
- Payload `DailySummary` tidak berubah bentuk.
