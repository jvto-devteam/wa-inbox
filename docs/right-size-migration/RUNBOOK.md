# Runbook penerapan: right-sizing Bot Control

Dibuat 2026-09-08. Menyertai branch `refactor/right-size-bot-control`.

**Status: BELUM DITERAPKAN ke produksi.** Kode sudah selesai dan lulus test; database
belum disentuh sama sekali. Dokumen ini urutan penerapannya.

`DATABASE_URL` di repo ini menunjuk **VPS produksi**. `prisma migrate dev` DILARANG —
ia bisa me-reset database saat mendeteksi drift. Hanya `migrate deploy`.

---

## Kenapa migrasinya dipecah dua

`prisma/migrations/` berisi dua folder baru:

| folder | isi | bisa dibalik? |
|---|---|---|
| `20260908110000_right_size_bot_control_additive` | `ADD COLUMN` × 10, `CREATE INDEX` × 1 | ya, aman |
| `20260908120000_right_size_bot_control_destructive` | `DROP TABLE` × 10, `DROP COLUMN` × 11, `DROP INDEX` × 3, `DROP CONSTRAINT` × 3 | **tidak** |

Dipecah supaya langkah pemindahan data di antaranya **tidak bisa terlewat**. Begitu tabel
lama di-DROP, nilainya tidak bisa dipindahkan lagi.

Kedua file itu digabung ulang dan dibandingkan dengan keluaran
`prisma migrate diff --from-schema <baseline> --to-schema prisma/schema.prisma --script`:
38 pernyataan, identik, tidak ada yang hilang atau berubah. Baseline schema-nya ada di
`schema-baseline-before-refactor.prisma` di folder ini.

---

## Urutan penerapan

### Langkah 0 — cadangkan

```
pg_dump --table='"BotRelease"' --table='"BotRuleSetting"' \
        --table='"BotFlowDefinition"' --table='"BotFlowVersion"' \
        --table='"BotTestCase"' --table='"BotTestRun"' --table='"BotTestResult"' \
        --table='"BotDecisionTriage"' --table='"ChannelPolicySetting"' \
        --table='"KnowledgeChunk"' --table='"BotControlAuditLog"' ...
```

`BotRelease.snapshot` adalah satu-satunya salinan konfigurasi lama yang tersimpan.
Baris audit hanya menyimpan field yang berubah, jadi ia **tidak bisa** merekonstruksinya.

### Langkah 1 — jalankan SELECT verifikasi

Setiap catatan di folder ini dibuka dengan blok `SELECT` read-only. Jalankan semuanya
dulu dan baca hasilnya. Semua statement di file-file itu **dikomentari** — tidak ada yang
jalan tanpa Anda mengaktifkannya.

Yang paling menentukan ada di `b2` LANGKAH 1a dan `b1` LANGKAH 1 — lihat "Dua jebakan"
di bawah.

### Langkah 2 — terapkan migrasi aditif

```
npx prisma migrate deploy
```

Menerapkan folder `..._additive` saja kalau folder destruktifnya belum ada di disk;
kalau keduanya sudah ada, **pindahkan dulu folder destruktif ke luar** `prisma/migrations/`,
jalankan deploy, lalu kembalikan setelah langkah 3 selesai.

### Langkah 3 — pindahkan data

Jalankan blok `UPDATE` dari catatan, **dalam urutan ini**:

1. `b2-data-migration-notes.sql` LANGKAH 3a — `defaultChannel` ⚠️ **jebakan 1**
2. `b1-data-migration-notes.sql` — dua sakelar ⚠️ **jebakan 2**
3. `b2-data-migration-notes.sql` LANGKAH 3b — empat angka pengaman outbound
4. `b2-data-migration-notes.sql` LANGKAH 3c — `pausedProviders` ⚠️ **wajib**
5. `a7-data-migration-notes.sql` — `fallbackReply` / `handoffReply`
6. `b3-data-migration-notes.sql` — status revisi knowledge (hanya kalau ada barisnya)
7. `b4-data-migration-notes.sql` — triage → `flaggedAt`/`flagNote` (hanya kalau ada barisnya)

`a8`, `b6`, `b7` tidak punya langkah pemindahan data — hanya verifikasi dan penghapusan.

### Langkah 4 — deploy kode baru

Deploy **sebelum** migrasi destruktif. Urutan sebaliknya membuat jalur publish knowledge
dari kode lama gagal di jendela antara keduanya.

Ikuti prosedur deploy repo ini: `git checkout` dari `origin/main` di VPS, dan **export PATH
Node 22 dari nvm** — Node 18 bawaan mematikan setiap perintah Prisma 7.

### Langkah 5 — terapkan migrasi destruktif

```
npx prisma migrate deploy
```

### Langkah 6 — verifikasi pasca-penerapan

- Kirim satu pesan uji ke nomor whitelist **6282143403501**. Jangan pernah ke customer nyata.
- Cek jalur yang tersisa: bot menjawab, handoff mengirim kalimatnya, antrean outbound jalan.
- Buka `/bot-control` — sub-nav tampil, kedelapan tab terjangkau (Ringkasan, Flow Map, Rules,
  Knowledge, Decision Logs, Test Lab, Outbound Queue, Audit Logs).
- Cek `pausedProviders` masih sesuai keadaan sebelum migrasi.

---

## Dua jebakan yang bisa merugikan

### Jebakan 1 — channel default berbalik (biaya uang)

`resolveChannel` lama mengembalikan `ChannelPolicySetting.defaultOutbound` lebih dulu dan
**tidak pernah** membaca `Settings.defaultChannel` selama baris kebijakan itu ada.

- baris kebijakan default: `UNOFFICIAL`
- default kolom `Settings.defaultChannel`: `OFFICIAL`

Kalau langkah 3 nomor 1 dilewat, **setiap balasan tanpa channel eksplisit pindah dari
Unofficial ke Official** — biaya percakapan Meta plus jendela 24 jam. `b2` LANGKAH 1a punya
kolom `default_channel_berubah` yang menjawab ini langsung.

### Jebakan 2 — bot mulai membalas nomor +62 yang seharusnya dipegang agen

`inbound.ts` lama berbunyi `settings.skipBotForIndonesianNumbers || skipViaRule` — **di-OR**.
Karena itu nilainya harus dipindahkan sebagai `settings OR rule.enabled`, **bukan disalin**.
Kalau rule pernah dipublish aktif sementara toggle-nya mati, menyalin apa adanya membuat bot
mulai menjawab nomor domestik yang dicadangkan untuk agen.

### Ditambah satu yang wajib

`pausedProviders` (langkah 3 nomor 4). Kalau ada provider yang sedang dijeda saat migrasi dan
jeda itu tidak ikut pindah, pesan langsung mengalir lagi ke provider yang bermasalah.
Pemulihannya murah kalau terlewat: satu klik "Jeda COEXIST" di `/bot-control/outbound-queue`,
idempoten dan langsung berlaku.

---

## Kalau harus dibatalkan

Sebelum langkah 5, pembatalan mudah: `git checkout main`, deploy kode lama. Migrasi aditif
boleh ditinggal terpasang — kolom tambahan tidak mengganggu kode lama.

Setelah langkah 5, tidak ada jalan balik selain `pg_restore` dari cadangan langkah 0.
