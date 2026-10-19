# Plan: Janji tim + Balas/Follow up siap kirim

Keputusan owner di chat 2026-10-19: kerjakan ide nomor 2 (lacak janji tim) dan nomor 4
(Balas/Follow up langsung siap kirim). Nomor 1 (antrean live sepanjang hari) belum diputuskan,
jadi jangan dikerjakan di sini.

## Global Constraints

- Komentar dan teks UI dalam Bahasa Indonesia, mengikuti gaya file sekitarnya. Dilarang `any`. Zod v4.
- File `'use client'` hanya boleh mengimpor modul route lewat `import type`.
- **Dilarang** perintah Prisma yang menyentuh DB (`DATABASE_URL` menunjuk produksi). Tidak ada
  perubahan skema DB: review disimpan di JSON, dan `SummaryItem.kind`/`closedReason` bertipe String.
- Tidak boleh ada pesan yang terkirim otomatis ke pelanggan. Semua kiriman tetap lewat klik operator.
- Test memakai mock prisma dan mock LLM.
- Gerbang wajib: `npm test`, `npx tsc --noEmit`, `npx eslint .` (0 error), lalu `npm run build`
  (exit 0, ditangkap tanpa pipe).
- Baca `CLAUDE.md`, terutama bagian "Summary harian" dan "Ringkasan chat".

---

## Task 1: Janji tim

**Masalah:** chat yang tertahan karena tim menjanjikan sesuatu ("saya cek dulu", "invoice
menyusul", "itinerary besok") tidak pernah masuk antrean. Pesan terakhirnya dari tim, dan
pelanggan belum diam 48 jam.

1. **Review LLM** (`src/lib/daily-summary/review.ts`, `payload-schema.ts`):
   - Tambah field `janjiTim` (opsional, default `[]`). Setiap butir berbentuk
     `{ teks, terpenuhi: boolean, messageId? }`; string lama tetap diterima.
   - Prompt: `"janjiTim":[{"teks":"...","terpenuhi":true|false,"pesan":N}]`. Isinya komitmen
     yang diucapkan TIM kepada pelanggan, misalnya mengirim harga/invoice/itinerary, mengecek
     ketersediaan, atau mengonfirmasi. `terpenuhi` bernilai true hanya bila transkrip
     menunjukkan janji itu sudah dilakukan. `pesan` adalah nomor `#N` pesan tempat janji
     diucapkan, dipetakan ke `messageId` dengan mekanisme yang sama seperti
     pertanyaan/poinPenting.
   - Parsing toleran per butir.
   - Tambah helper `normalizePromise()`.
2. **Item antrean kind `PROMISE`** (`src/lib/summary-items/sync.ts`). Satu baris per percakapan
   tetap berlaku (`conversationId @unique`).
   - Saat `syncSummaryItems`: percakapan di payload (bagian mana pun yang punya review) yang
     review-nya memuat janji `terpenuhi:false`, dan yang BUKAN kandidat REPLY/FOLLOW_UP, menjadi
     kandidat `PROMISE`. `anchorAt` adalah waktu pesan janji (lookup `messageId`), atau akhir
     hari bila tidak ada.
   - Aturan buka ulang dan baris yang sudah DONE/DROPPED mengikuti pola yang ada.
   - REPLY/FOLLOW_UP selalu menang atas PROMISE untuk percakapan yang sama.
   - Penutupan:
     - Review berikutnya untuk percakapan itu (job malam atau tombol Perbarui) tidak lagi
       memuat janji yang belum terpenuhi → `DONE`, `closedReason 'PROMISE_KEPT'`.
     - Ada pesan INBOUND sesudah anchor → diubah menjadi REPLY lewat jalur rekonsiliasi yang
       sudah ada (perlakukan PROMISE seperti FOLLOW_UP untuk konversi inbound).
     - Ingatkan/Lepas tetap berlaku.
   - Buat fungsi bersama `applyReviewToItem(conversationId, review, asOf)`. Fungsi ini juga
     dipanggil dari `POST /api/conversations/[id]/chat-review` setelah Perbarui berhasil.
     Fungsi tidak pernah melempar.
3. **UI:**
   - Kartu antrean (`SummaryQueue`), tampilan tanggal (`SummaryDayView`), dan tab Ringkasan chat
     (`ChatReviewTab`) menampilkan label kind PROMISE **"Janji tim"**.
   - Status live untuk PROMISE OPEN: **"Janji belum ditepati"**. Pemetaan status dipusatkan di
     `src/lib/summary-items/status.ts`.
   - `closedReason` `PROMISE_KEPT` → "janji ditepati".
   - Daftar janji tampil dengan ✅ ditepati / ⏳ belum, dan bisa diklik ke pesannya (`lihat=1`).
   - Aksi utama kartu PROMISE adalah "Buka chat" (tautan ke pesan janji).
   - Pakai komponen daftar yang sama dengan pertanyaan. Jangan menduplikasi.
4. **Test:** prompt/parse/mapping janji; kandidat PROMISE dibuat hanya bila bukan REPLY/FOLLOW_UP;
   prioritas REPLY atas PROMISE; ditutup PROMISE_KEPT lewat sync dan lewat Perbarui; inbound
   mengubah PROMISE menjadi REPLY; render UI dan label status.
5. Perbarui bagian "Summary harian" dan "Ringkasan chat" di CLAUDE.md, cukup 1–2 kalimat.

---

## Task 2: Balas / Follow up siap kirim

1. **Balas** (item REPLY): tautan menambah `&draft=1`.
   - Di Inbox, bila `draft=1` dan pesan fokus adalah pesan INBOUND yang belum punya draft,
     picu sekali alur "Generate draft" yang sudah ada untuk pesan itu (cari mekanisme
     `MessageDraft` / `/draft` di ThreadView). Jangan picu ulang saat re-render atau saat
     parameter lain berubah.
   - Draft hanya ditampilkan. Tidak ada yang terkirim otomatis.
2. **Follow up** (item FOLLOW_UP): tautan menambah `&followup=1`.
   - Di Inbox, tentukan apakah kanal percakapan butuh template karena jendela layanan
     (24 jam) sudah tertutup. Pakai `channel-capabilities.ts` dan waktu pesan INBOUND terakhir;
     ikuti logika yang sudah dipakai composer, jangan menulis aturan baru.
   - Bila butuh template, buka pemilih template di composer secara otomatis. Bila tidak,
     fokuskan kursor ke kotak balasan.
3. Kedua parameter memakai pola `urlKey` di `inbox/page.tsx` yang sudah ada untuk
   `message`/`lihat`.
4. **Test:** href Balas/Follow up memuat parameter yang benar; `draft=1` memicu generate tepat
   sekali; tidak memicu bila draft sudah ada; `followup=1` membuka pemilih template saat jendela
   tertutup dan memfokuskan composer saat jendela terbuka.
