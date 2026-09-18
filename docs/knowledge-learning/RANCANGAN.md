# Pembelajar Knowledge Harian — Rancangan v3

**Status:** rancangan, 2026-09-17. Belum ada kode. Revisi hari yang sama: ralat volume percakapan dan
nilai `reason` gap log setelah diukur langsung di produksi; ekstraksi dibuat inkremental.
**Pemeriksa:** `node docs/knowledge-learning/check-rancangan.mjs` — wajib hijau sebelum dokumen ini
dipakai atau diubah. Setiap angka dan nama simbol di bawah dicek ulang ke sumbernya oleh skrip itu.

Padanan teknis: *conversational knowledge base population with human-in-the-loop curation*.
Tidak ada model yang dilatih; yang dibangun adalah kurasi knowledge dengan persetujuan operator.

---

## 1. Keputusan operator yang sudah diambil (tidak dibuka ulang)

Sumber: sesi rancangan 2026-09-16. Bukan dari kode — pipeline-nya belum ada.

1. Sistem menyiapkan usulan; **operator yang mengaktifkan**. Tidak pernah publish otomatis.
2. Ambang **2 percakapan berbeda, tanpa pengecualian** — termasuk kalimat kebijakan eksplisit
   ("standar", "selalu", "semua paket").
3. Permintaan pelanggan dan nilai milik satu booking **tidak** menjadi knowledge; percakapan
   pasca-booking **tetap dibaca**.
4. Kondisi sementara (penutupan Bromo/Ijen dan sejenisnya) **di luar lingkup** — dilaporkan saja.
5. Harga diperbaiki **di katalog**, bukan ditambahkan sebagai knowledge.
6. Selama bot tidak membalas pelanggan, keberhasilan diukur lewat **set regresi 327 topik**,
   bukan lewat gap log.

## 2. Kondisi awal yang terukur

Dari `docs/replay/` (belum di-commit — berisi data kerja, bukan kode):

| Angka | Nilai | Sumber |
| --- | --- | --- |
| Percakapan dibaca utuh | 371 | `docs/replay/knowledge-percakapan-admin-2026-09-15.json` → `ringkasan` |
| Rentang tanggal fakta | 2026-07-27 s.d. 2026-09-15 (51 hari) | `rujukanFakta[].tanggal` |
| Fakta diekstrak / dinilai | 1.686 / 1.660 | `ringkasan` |
| Fakta dihitung penuh setelah saringan v6 | 1.537 (92,6%) | `buktiSetelahSaringan` |
| Fakta didemosikan / dibuang | 30 / 80 | `buktiSetelahSaringan` |
| Topik / layak ditambahkan | 327 / 229 | `ringkasan` |
| Topik dengan cukup bukti | 214 | `topikPerStatusAmbang` |
| Belum layak: sudah diketahui bot / ditahan / sementara | 52 / 30 / 16 | `alasanBelumLayak` |
| Keputusan operator: total (lolos / tahan) | 149 (119 / 30) | `docs/replay/keputusan-operator-2026-09-16.json` |
| Usulan siap: baru / melengkapi / koreksi / sementara | 113 / 77 / 32 / 7 | `docs/replay/knowledge-baru-2026-09-16.json` |
| Revisi PUBLISHED keliru dengan naskah perbaikan | 4 (+1 perlu ditinjau) | `docs/replay/perbaikan-knowledge-published-2026-09-16.json` |

Naskah perbaikan dan 229 usulan **belum diterapkan** ke database.

### Kondisi produksi (kueri baca-saja, batas waktu 2026-09-17 00:00 WIB)

Diukur langsung di database produksi dalam transaksi `READ ONLY`. Semua angka dibatasi waktu supaya
tetap bisa dicek ulang besok dengan hasil yang sama.

| Angka | Nilai | Artinya |
| --- | --- | --- |
| Percakapan non-test | 375 | Ekstrak `docs/replay/` (371) hampir mutakhir |
| Percakapan baru per minggu penuh | 118, 67, 40, 33, 34, 43, 35 | Kondisi stabil: **33–43 per minggu** (minggu pertama kemungkinan riwayat yang terimpor) |
| Percakapan aktif per hari, 2026-08-01 s.d. 2026-09-16 | rata-rata 31,8, median 29, rentang 15–68 | Inilah input harian pipeline |
| Pesan `BOT` sejak 2026-08-10 | 0 | Bot tidak membalas pelanggan; pemakai knowledge satu-satunya adalah draft Inbox |
| Draft: dibuat / terkirim / terkirim dan diedit | 10 / 4 / 4 | Sinyal koreksi admin nyata, datanya masih sangat sedikit |
| `KnowledgeGapLog`: baris / percakapan / topik | 38 / 3 / 7 | Belum bisa dipakai sebagai sinyal |
| `KnowledgeGapLog.reason` yang ada | `reply_deferred_knowledge` (30), `reply_unsourced` (8) | Tidak ada satu pun `no_facts_resolved` atau `verification_failed` |
| Versi tertinggi yang terbit: BLUE FIRE, BEST TIME, GENERAL, PAYMENT, DESTINATIONS | v1 semuanya | P1 belum diterapkan; draft admin masih memakai entri yang keliru |

## 3. Batasan sistem yang dipatuhi (terverifikasi dari kode)

- **Plafon retrieval.** `MAX_MANAGED_ITEMS_PER_TURN` = 8 (`src/lib/bot/runtime-integration.ts`).
  Urutannya: item yang lolos lewat topik didahulukan, lalu jumlah kata yang sama antara pesan
  pelanggan dan `question`/`tags`. Item baru merebut kuota dari item yang sudah benar.
- **Skema item.** `knowledgeItemSchema` hanya punya question, answer, tags, topics, links, prices
  (`src/lib/bot-control/knowledge-body.ts`). Tidak ada masa berlaku.
- **Topik sah.** `RESOLVER_TOPICS` berisi 14 topik (`src/lib/bot/module-resolver.ts`).
- **Katalog yang dimuat.** `buildCatalog` membaca 10 file (`src/lib/bot/catalog.ts`); `catalog/meta.json`
  dibaca terpisah hanya untuk waktu sinkron. Aturan rute dari `catalog/itinerary-intelligence/`
  sampai ke prompt lewat `evaluateScenario` (`src/lib/bot/scenario-evaluator.ts`).
- **Pesan bot.** `SentBy` punya `BOT`, `AGENT`, `CUSTOMER`. Balasan otomatis bot = `BOT`.
  Draft bot yang dikirim admin tertaut lewat `MessageDraft.sentMessageId`; teks asli bot ada di
  `generatedText`, teks yang dikirim di `text` (`sendDraft` mengirim `text` yang sudah di-trim).
- **Gap log.** Dua penulis dengan `reason` berbeda:
  - `recordUnsourcedReplyGap` menulis `reply_unsourced` / `reply_deferred_knowledge`
    (`src/lib/inbox/gap-signal.ts`). Hanya dipanggil setelah balasan terkirim — dari
    `src/lib/inbound.ts` dan `src/lib/inbox/message-draft.ts` — dan hanya untuk keputusan mode `faq`.
  - `recordKnowledgeGap` di `src/lib/bot/orchestrator.ts` menulis `no_facts_resolved` /
    `verification_failed`. Di produksi belum ada satu baris pun dengan kedua nilai ini.

  Sinyal ini jarang dan miring selama bot tidak membalas pelanggan.
- **Aturan pasangan replay.** `src/lib/bot/eval/replay-pairs.ts` hanya menangani pesan pembuka.
  Konstantanya (`BURST_DEBOUNCE_MS`, `BURST_MAX_WAIT_MS`, `ADMIN_REPLY_WINDOW_MS`,
  `MIN_CUSTOMER_CHARS`, `MIN_ADMIN_CHARS`, `BROADCAST_MIN_CONVERSATIONS`) tidak dirancang untuk
  giliran lanjutan.
- **Knowledge PUBLISHED immutable.** Setiap perubahan = revisi baru lewat `saveKnowledgeDraft` →
  `publishKnowledgeRevision` (`src/lib/bot-control/knowledge-workflow.ts`); revisi lama diarsipkan
  sistem.

---

## 4. Tahap persiapan (sebelum run harian pertama)

Urutan ini wajib. Pipeline harian tanpa tahap ini mengusulkan ulang semua yang sudah diputuskan,
dan menambah knowledge di atas entri yang sedang keliru.

**P1 — Perbaiki revisi PUBLISHED yang keliru.** Terapkan 4 naskah di
`docs/replay/perbaikan-knowledge-published-2026-09-16.json` (BLUE FIRE, BEST TIME, GENERAL, PAYMENT) lewat
alur normal operator, dan putuskan 1 yang perlu ditinjau (DESTINATIONS). Per batas waktu di atas,
kelimanya masih v1 dan dipakai setiap draft jawaban di Inbox; ini didahulukan dari penambahan apa
pun.

**P2 — Selesaikan backlog.** 229 usulan di `docs/replay/knowledge-baru-2026-09-16.json` diterapkan dengan
strategi penggabungan (Langkah 8), bukan satu item per usulan. Yang 7 `sementara` tidak diterapkan.

**P3 — Bangun set uji dan isi sidik jari awal.**
- Set uji = 371 percakapan + status 327 topik + 149 keputusan operator.
- Semua 327 topik dimasukkan ke tabel sidik jari beserta statusnya (layak, ditahan, sudah diketahui,
  sementara). Tanpa ini, hari pertama mengusulkan ulang keputusan yang sudah ada.

**P4 — Ukur pipeline ke set uji.** Operator menetapkan target **sebelum** melihat hasil:
- *jangkauan*: berapa dari 229 topik layak yang ditemukan pipeline;
- *salah usul*: berapa usulan jatuh ke topik yang ditahan (30), sementara (16), atau sudah diketahui
  bot (52);
- *tolok ukur negatif*: tiga kasus "jam jemput 12.00" wajib tersaring.

Pipeline tidak lanjut ke run harian sebelum target terpenuhi.

---

## 5. Pipeline harian

Dijalankan sebagai skrip di VPS (seperti `scripts/replay-agent-answers.ts`), bukan lewat route HTTP
— pekerjaan LLM atas banyak percakapan tidak boleh bergantung pada batas waktu request.

### Langkah 0 — Bahan

- **Ekstraksi inkremental.** Yang diekstrak hanya **pesan baru** sejak run terakhir (dengan
  tumpang-tindih 24 jam), sedangkan riwayat percakapan sebelumnya ikut dikirim **sebagai konteks
  saja** — fakta tidak diambil dari riwayat itu lagi. Tanpa ini, sekitar 30 percakapan aktif per hari
  dibaca ulang utuh setiap hari: biaya LLM berlipat dan fakta lama diekstrak berulang.
- Setiap bukti terikat ke `messageId`, jadi tumpang-tindih 24 jam tidak pernah menggandakan dukungan.
- Dilewati: sandbox/uji, grup internal dan partner, nomor bisnis sendiri.
- Percakapan pasca-booking tetap ikut.
- **Penyamaran sebelum model.** Nomor telepon, email, dan nomor rekening diganti placeholder dengan
  regex **sebelum** teks dikirim ke LLM. Model produksi adalah tag cloud; teks keluar VPS.
- Sinyal prioritas (dibaca dulu, bukan satu-satunya bahan):
  1. **Draft bot yang diedit admin** — `generatedText` ≠ `text` pada draft yang punya
     `sentMessageId`. Selisihnya adalah koreksi eksplisit admin terhadap bot.
  2. Baris `KnowledgeGapLog` yang `resolvedAt`-nya kosong — sinyal tambahan saja (hanya mode `faq`,
     hanya balasan yang terkirim; per batas waktu baru 38 baris dari 3 percakapan).

### Langkah 1 — Unit dan peran pesan

Unit = **seluruh percakapan**, bukan pasangan pembuka. Setiap pesan diberi peran:

| Pesan | Perlakuan |
| --- | --- |
| `sentBy` = `CUSTOMER` | Konteks + sumber asal nilai (untuk demosi) |
| `sentBy` = `AGENT`, bukan dari draft | **Sumber knowledge** |
| `sentBy` = `AGENT`, dari draft, tidak diedit | Dibuang — itu tulisan bot |
| `sentBy` = `AGENT`, dari draft, diedit | Hanya bagian yang diubah admin menjadi sumber, prioritas tinggi |
| `sentBy` = `BOT` | Dibuang |
| Broadcast (teks sama di ≥ 3 percakapan) dan notifikasi `[JVTO]` | Dibuang |

Informasi yang dimulai admin tanpa pertanyaan (instruksi pasca-booking) tetap ikut. Aturan pasangan
replay hanya dipakai sebagai konteks untuk mengetahui pertanyaan mana yang dijawab admin.

### Langkah 2 — Ekstraksi ke slot terstruktur

Setiap kandidat berbentuk:

| Slot | Isi |
| --- | --- |
| `jenis` | `aturan` / `harga` / `operasional_booking` / `sementara` |
| `topik` | salah satu dari 14 `RESOLVER_TOPICS` |
| `subjek` | hal yang diatur (mis. "jemput hari pertama") |
| `syarat` | kondisi berlakunya, ternormalisasi |
| `nilai` | nilai ternormalisasi (jam, uang, jumlah) |
| `pernyataan` | kalimat utuh |
| `kutipan_admin` | potongan persis dari pesan admin |
| `messageId`, `tanggal` | asal bukti |
| `asal_nilai` | `admin` / `pelanggan` |

Ekstraksi yang gagal atau terdegradasi **menghentikan run** dengan kode keluar ≠ 0. Tidak ada
percakapan yang dilewati diam-diam.

### Langkah 3 — Saringan mekanis (saringan v6, disalin persis)

Tanpa model, berurutan, setiap yang gugur dicatat alasannya.

1. **Normalisasi dulu:** "12pm" = "12:00", "IDR 900.000" = "900,000".
2. **Kutipan persis:** `kutipan_admin` harus ada di pesan `AGENT` percakapan itu. Kalau tidak,
   gugur.
3. **Nilai milik booking:** dibuang bila nilainya sama dengan `bookingData` percakapan itu (tanggal
   tur, pax, kode booking, nominal total).
4. **Tiga kondisi buang v6:**
   a. ada kata waktu relatif ("besok", "hari ini", "tonight");
   b. kepemilikan + nilai konkret ("hotel Anda" + nama/jam);
   c. **pernyataan jam jemput di percakapan yang sedang mengatur booking.**
   Kata "normal", "standar", "biasanya", "semua paket" menyelamatkan kandidat dari a–c.
5. **Demosi:** bila `asal_nilai` = `pelanggan`, kandidat disimpan sebagai bukti pendukung tetapi
   tidak dihitung menuju ambang.
6. **Data pribadi:** nama, telepon, email, nomor rekening dibuang dari kutipan.
7. **Pengarahan jenis:**
   - `jenis` = `harga` → **laporan koreksi katalog**, tidak pernah jadi draft knowledge;
   - `jenis` = `sementara` → **laporan kondisi sementara**, tidak pernah jadi draft.

Saringan tidak diubah sebelum lolos ulang terhadap P4. Perubahan saringan = ukur ulang.

### Langkah 4 — Klaim dan sidik jari

- **Sidik jari** = hash dari `topik` + `subjek` + `syarat` yang sudah dinormalisasi. **`nilai`
  tidak ikut** — supaya perubahan nilai muncul sebagai pertentangan di bawah klaim yang sama, bukan
  sebagai klaim baru.
- **Dukungan disimpan sebagai himpunan** `(sidik jari, conversationId, messageId, nilai, tanggal)`
  yang unik — bukan penghitung. Ambang dihitung dari `conversationId` yang berbeda; membaca ulang
  pesan yang sama tidak menambah dukungan.
- Pencarian calon kembar (kalimat berbeda, fakta sama) boleh memakai embedding **lokal** lewat
  Ollama, hanya untuk mencari pasangan yang perlu dibandingkan. Keputusan "sama" tetap dari slot.
  Ketersediaan model embedding di VPS **belum diperiksa**.

### Langkah 5 — Ambang dan waktu

- Sebuah **nilai** menjadi usulan bila didukung **≥ 2 percakapan berbeda** dari bukti yang tidak
  didemosikan. Tanpa pengecualian.
- Bukti 1 percakapan → kolam "belum cukup bukti"; operator bisa menaikkannya manual; kedaluwarsa
  setelah 90 hari tanpa bukti baru *(usulan awal, bisa diubah)*.
- **Dua nilai dalam satu sidik jari** → status `kemungkinan_kebijakan_berubah`. Kartu menampilkan
  kedua nilai dengan tanggal bukti **terakhir** masing-masing. Nilai tidak pernah dimenangkan oleh
  jumlah bukti — kebijakan lama selalu punya bukti lebih banyak. Operator yang memilih.

### Langkah 6 — Cocokkan ke yang sudah ada

Pembanding: revisi knowledge `PUBLISHED` + 10 file yang dibaca `buildCatalog` + aturan rute
`itinerary-intelligence` yang sampai ke prompt.

| Hasil | Tindakan |
| --- | --- |
| Sidik jari & nilai sama | Menguatkan. Dukungan ditambah, tidak masuk antrean. |
| Sidik jari sama, syarat baru | Usulan **melengkapi item yang ada** |
| Sidik jari sama, nilai berbeda | Usulan **mengganti**, dengan perbandingan lama vs baru dan tanggal |
| Tidak cocok ke mana pun | Usulan baru |
| Entri yang memuat kalimat benar **dan** kalimat bertentangan | **Laporan pertentangan** — tidak pernah draft otomatis |
| Bertentangan dengan katalog | **Laporan koreksi katalog** — tidak bisa diaktifkan |

Pencocokan dilakukan **per kalimat** entri, bukan per entri. Satu kalimat yang cocok tidak boleh
menutupi kalimat lain yang bertentangan (kasus BLUE FIRE).

Detektor pertentangan dibangun **sebelum** jalur usulan baru.

### Langkah 7 — Kondisi sementara

Dilaporkan, tidak pernah jadi draft. Kedaluwarsa otomatis butuh perubahan skema lebih dulu
(`knowledgeItemSchema` tidak punya masa berlaku) — tidak diakali di pipeline. Contoh pemisahan yang
sudah ada: `docs/replay/pemisahan-sementara-2026-09-17.json`.

### Langkah 8 — Antrean kartu dan aktivasi

Kartu berisi: pernyataan, syarat, nilai, jumlah percakapan pendukung, tanggal bukti pertama dan
terakhir, kutipan admin, dan perbandingan bila menggantikan. Kartu juga menampilkan:

- **Target penggabungan.** Default: melengkapi item yang sudah ada di topik serumpun. Item baru hanya
  bila tidak ada yang serumpun.
- **Beban topik.** Jumlah item `PUBLISHED` yang sudah ber-`topics` sama; peringatan bila melebihi
  `MAX_MANAGED_ITEMS_PER_TURN`, karena plafon mulai memotong.
- **`topics` wajib** (dari 14 `RESOLVER_TOPICS`), walau skemanya opsional. Pipeline yang menegakkan,
  bukan skema.
- **`question` dan `tags`** memakai kosakata pelanggan yang asli (sudah disamarkan), karena itulah
  yang dicocokkan kata per kata saat retrieval.

Tindakan:
- **Aktifkan** → `saveKnowledgeDraft` + `publishKnowledgeRevision`, tercatat di audit log, revisi lama
  diarsipkan sistem.
- **Tolak** → alasan disimpan di sidik jari. Muncul lagi hanya bila **nilainya berubah**, atau ada
  **≥ 3 percakapan pendukung baru** setelah tanggal penolakan *(usulan awal)*.
- **Perlu keputusan** → tetap di antrean dengan catatan.

### Langkah 9 — Umpan balik

- **Ukuran utama:** setiap topik yang diaktifkan diuji ulang lewat set regresi 327 topik (replay
  pertanyaan pelanggan asli ke bot, dibandingkan dengan jawaban admin).
- **Ukuran tambahan:** baris `KnowledgeGapLog` baru pada topik itu setelah aktivasi. Yang benar-benar
  tertulis di produksi saat ini hanya `reply_unsourced` (jawaban tanpa sumber knowledge) dan
  `reply_deferred_knowledge` (sub-pertanyaan ditunda karena knowledge kurang). Keduanya berarti
  "knowledge tidak ada atau tidak terambil" — periksa `topics`/`tags` dulu, baru isinya.
  `no_facts_resolved` dan `verification_failed` baru relevan setelah bot kembali membalas pelanggan.

---

## 6. Peluncuran bertahap

| Fase | Isi | Syarat lanjut |
| --- | --- | --- |
| F1 | P1–P4 | Target P4 terpenuhi |
| F2 | Run harian **laporan saja**, tanpa antrean kartu | Operator membaca laporan beberapa minggu dan tidak menemukan pola salah usul baru |
| F3 | Run harian + antrean kartu, ditinjau **mingguan** | — |

Dengan 33–43 percakapan baru per minggu dan ambang 2, satu hari jarang menghasilkan usulan. Run tetap
harian (inkremental, sekitar 30 percakapan aktif per hari); peninjauan cukup mingguan.

## 7. Batasan yang dijaga

- Tidak ada yang aktif tanpa klik operator.
- Sistem hanya menulis ke knowledge (sebagai usulan), tidak pernah ke katalog.
- Usulan yang bertentangan dengan katalog hanya menjadi laporan.
- Setiap usulan bisa ditelusuri ke `messageId` dan kutipan aslinya.
- Tidak ada pesan terkirim ke pelanggan dari proses ini.
- Tidak menyentuh `src/lib/bot/deployment-gate.ts`.

## 8. Yang berubah dari versi sebelumnya

| # | Sebelumnya | Sekarang | Alasan |
| --- | --- | --- | --- |
| 1 | Unit = pasangan pertanyaan → blok jawaban | Unit = percakapan utuh | Aturan pasangan hanya untuk pesan pembuka; hasil 92,6% datang dari pembacaan utuh |
| 2 | Tanpa dimensi waktu, "hitungan naik" | Bukti bertanggal, himpunan unik, status kebijakan berubah | Kebijakan lama selalu punya bukti lebih banyak |
| 3 | Gap log = bahan prioritas tertinggi dan alat ukur | Sinyal tambahan; alat ukur = set regresi 327 topik | Gap hanya mode `faq` dan hanya balasan terkirim |
| 4 | Tidak ada tahap persiapan | P1–P4 | Backlog, perbaikan, dan keputusan sudah ada |
| 5 | Semua pesan draft dibuang | Draft diedit = sinyal prioritas | Selisih `generatedText`/`text` adalah koreksi admin |
| 6 | "Sama" tidak didefinisikan | Sidik jari dari slot, tanpa nilai | Kalimat LLM tidak stabil antar-run |
| 7 | Dukungan = penghitung | Himpunan `(klaim, percakapan)` | Pembacaan ulang menggandakan hitungan |
| 8 | Aktivasi = item baru | Default melengkapi item yang ada + peringatan beban topik | Plafon 8 item per giliran |
| 9 | Aturan tarif dijadikan knowledge | `jenis` = `harga` → laporan katalog | Keputusan operator: harga diperbaiki di katalog |
| 10 | Saringan dua kondisi | Tiga kondisi v6 persis | Kondisi jemput-saat-booking hilang dari versi sebelumnya |
| 11 | Langkah 5 "menunggu penegasan" | Sudah diputuskan: tanpa pengecualian | Keputusan 2026-09-16 |
| 12 | Detektor pertentangan setelah pipeline | P1 lebih dulu, detektor sebelum jalur usulan | Kerugian yang sedang berjalan didahulukan |
| 13 | "10 file katalog" tanpa rincian | 10 file `buildCatalog` + aturan rute itinerary | Pembanding yang tidak lengkap meloloskan pertentangan |
| 14 | Data pribadi disaring setelah ekstraksi | Disamarkan regex sebelum dikirim ke model | Model produksi adalah tag cloud |
| 15 | Cara menjalankan tidak disebut | Skrip VPS, tinjauan mingguan | Volume 33–43 percakapan baru/minggu; batas waktu request |
| 16 | Percakapan dibaca utuh setiap run | Hanya pesan baru diekstrak, riwayat sebagai konteks | Sekitar 30 percakapan aktif per hari; membaca ulang utuh melipatgandakan biaya dan ekstraksi |
| 17 | Langkah 9 memakai `no_facts_resolved` / `verification_failed` | Memakai `reply_unsourced` / `reply_deferred_knowledge` | Hanya dua nilai itu yang ada di produksi |

## 9. Nama baru rancangan (belum ada di kode)

Nama berikut sengaja belum ada di repo; pemeriksa mengizinkannya hanya karena terdaftar di sini:
`jenis`, `topik`, `subjek`, `syarat`, `nilai`, `pernyataan`, `kutipan_admin`, `tanggal`,
`asal_nilai`, `aturan`, `harga`, `operasional_booking`, `sementara`, `admin`, `pelanggan`,
`kemungkinan_kebijakan_berubah`.

## 10. Belum terverifikasi

- Ketersediaan model embedding lokal di Ollama VPS.
- Batas waktu proxy/request di VPS (alasan memilih skrip, bukan route).
- Angka 90 hari (kedaluwarsa kolam) dan ≥ 3 percakapan (munculnya kembali usulan yang ditolak) adalah
  usulan awal, bukan hasil pengukuran.
- Keputusan operator di bagian 1 bersumber dari sesi 2026-09-16, bukan dari kode.
- Apakah 118 percakapan di minggu pertama memang riwayat yang terimpor.
- Stabilitas sidik jari antar-run (belum pernah diukur; eksperimen: ekstraksi dua kali pada ±30
  percakapan).
