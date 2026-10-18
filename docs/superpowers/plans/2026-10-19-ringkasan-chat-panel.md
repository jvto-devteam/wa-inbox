# Plan: Tab "Ringkasan chat" di panel kanan Inbox

Spec: keputusan owner di chat 2026-10-19, dicatat di sini (tidak ada dokumen spec terpisah).

- Panel kanan Inbox (`src/components/inbox/ContactPanel.tsx`) mendapat tab **"Ringkasan chat"** di samping isi kontak yang sekarang.
- Isinya: (1) **status tindak lanjut** live dari `SummaryItem` + tombol Ingatkan/Lepas; (2) **poin penting terbaru** dari penilaian ollama — topik, status, pertanyaan pelanggan **masing-masing ditandai terjawab/belum**, poin penting, apa yang sudah dijawab/dijanjikan tim, langkah berikut; (3) **riwayat per hari** dari `DailySummary` (30 hari).
- Kesegaran: hasil job 00:00 **plus** tombol "Perbarui sekarang" yang memanggil ollama untuk percakapan itu saat diklik, hasilnya disimpan.
- Per pertanyaan: prompt ollama diubah supaya setiap pertanyaan bertanda `terjawab`. Ringkasan lama (pertanyaan berupa string) tetap terbaca, tampil tanpa tanda.
- Percakapan yang sekadar aktif tetap dinilai LLM (keputusan owner 2026-10-18) — jangan diubah.

## Global Constraints

- Komentar & teks UI Bahasa Indonesia, gaya file sekitar; komentar kepala file menjelaskan *kenapa*.
- Dilarang `any`. Zod v4.
- **Dilarang** perintah Prisma yang menyentuh database (`DATABASE_URL` = produksi): hanya `npx prisma generate` dan `npx prisma migrate diff --from-schema … --to-schema … --script` offline. Migrasi harus aditif saja (tanpa `DROP`).
- Test memakai mock prisma (pola `src/lib/daily-summary/collect-db.test.ts`) dan mock `callLLM`/`reviewConversation`; tidak ada panggilan LLM atau DB sungguhan di test.
- Route: `getSession` (401), Zod untuk body, error `{ error: string }`, try/catch, tanpa membocorkan error mentah. Tidak menulis `BotControlAuditLog`.
- Gerbang sebelum commit: `npm test`, `npx tsc --noEmit`, `npx eslint .` (0 error). Task 2 juga `npm run build` (exit 0).

---

## Task 1: Penilaian per pertanyaan, penyimpanan ringkasan terbaru, API

**Files:** `src/lib/daily-summary/payload-schema.ts`, `src/lib/daily-summary/review.ts` (+test), `src/lib/daily-summary/generate.ts` (+test), `prisma/schema.prisma`, `prisma/migrations/20261019100000_conversation_chat_review/migration.sql`, baru `src/lib/chat-review/` (`store.ts`, `history.ts` + test), baru `src/app/api/conversations/[id]/chat-review/route.ts` (+ `route.test.ts`).

1. **Skema pertanyaan.** Di `conversationReviewSchema`, `pertanyaan` menjadi `z.array(z.union([z.string(), z.object({ teks: z.string(), terjawab: z.boolean() })]))`. Ekspor tipe `ReviewQuestion` dan helper `normalizeQuestion(q): { teks: string; terjawab: boolean | null }` (string lama → `terjawab: null`). Cari semua pemakai `pertanyaan` di `src` dan sesuaikan supaya tsc tetap hijau.
2. **Prompt** (`REVIEW_SYSTEM_PROMPT` di review.ts): bentuk JSON memakai `"pertanyaan":[{"teks":"...","terjawab":true}]`. Aturannya: "pertanyaan" berisi pertanyaan/permintaan penting pelanggan (maks 5), dan `terjawab` true hanya bila tim sudah menjawabnya dengan jelas di transkrip. Parser/clip di review.ts mengikuti bentuk baru: `teks` di-clip, item tanpa `teks` dibuang, dan string polos dari model tetap diterima.
3. **Kolom baru di `Conversation`** (aditif): `chatReview Json?` (sebuah `ConversationReview`) dan `chatReviewAt DateTime?` (waktu "per" hasil itu berlaku). Komentar `///` menjelaskan bahwa ini adalah ringkasan terbaru untuk panel Inbox, diisi job harian atau tombol Perbarui. Buat migrasi offline dengan `migrate diff` dari `git show HEAD:prisma/schema.prisma`. SQL hanya boleh berisi `ALTER TABLE "Conversation" ADD COLUMN …`. Lalu `npx prisma generate`.
4. **`src/lib/chat-review/store.ts`:** `saveChatReview(conversationId, review, asOf: Date)` menulis dengan `updateMany({ where: { id, OR: [{ chatReviewAt: null }, { chatReviewAt: { lt: asOf } }] }, data: { chatReview, chatReviewAt: asOf } })`, supaya ringkasan tanggal lama yang dibuat ulang tidak menimpa hasil yang lebih baru. Fungsi ini tidak pernah melempar.
5. **generate.ts:** setelah payload tersimpan, panggil `saveChatReview(conversationId, review, day.end)` untuk setiap review non-null. Kegagalannya tidak mengubah status ringkasan.
6. **`src/lib/chat-review/history.ts`:** `chatReviewHistory(conversationId)` membaca ≤31 baris `DailySummary` terbaru (`orderBy date desc`), mem-parse payload dengan `dailySummaryPayloadSchema.safeParse` (baris yang gagal dilewati), lalu mencari review percakapan itu di `conversations`, `unreplied`, `dormant`, dan `newLeads`. Yang diambil adalah review non-null pertama yang ditemukan. Hasilnya `{ date: string; review: ConversationReview }[]`, terbaru dulu.
7. **Route `src/app/api/conversations/[id]/chat-review/route.ts`:**
   - **GET** → `{ latest: { review, at } | null, item: ChatReviewItem | null, history }`. `latest` diambil dari `Conversation.chatReview`/`chatReviewAt` (`safeParse`, gagal → null). `item` adalah `SummaryItem` percakapan itu dalam state apa pun: `{ id, kind, state, anchorAt, dueAt, closedReason, note, closedAt }` (ISO string). Panggil `reconcileSummaryItems()` dulu supaya status live. Percakapan tidak ada → 404.
   - **POST** (tanpa body) → ringkas sekarang. Ambil 30 pesan terakhir dengan field yang dibutuhkan `buildTranscript` (`src/lib/daily-summary/collect.ts`, batas `TRANSCRIPT_*` di config.ts). Alasannya `['unreplied']` bila pesan terakhir INBOUND, selain itu `['active']`. Panggil `reviewConversation(transcript, reasons, Settings.ollamaModel)`. Hasil null → 502 `{ error: 'Gagal meringkas. Coba lagi.' }`. Berhasil → `saveChatReview(id, review, new Date())`, lalu kembalikan bentuk yang sama dengan GET. Penjaga spam: bila `chatReviewAt` kurang dari 30 detik lalu, langsung kembalikan yang ada tanpa memanggil LLM. Percakapan tanpa pesan → 400.
   - Test: 401; 404; bentuk GET (latest, item DONE dengan closedReason, history dari 2 payload termasuk payload rusak yang dilewati); POST memanggil review dengan alasan yang benar dan menyimpan; POST 502 saat review null; penjaga 30 detik; saveChatReview tidak menimpa hasil yang lebih baru (where-clause).

---

## Task 2: Tab "Ringkasan chat" di panel kanan

**Files:** `src/components/inbox/ContactPanel.tsx`, baru `src/components/inbox/ChatReviewTab.tsx` (+ test), `src/components/daily-summary/SummaryQueue.tsx` (hanya bila perlu mengekspor panel Ingatkan/Lepas supaya bisa dipakai ulang; jangan duplikasi logikanya).

Dari Task 1: `GET/POST /api/conversations/[id]/chat-review` → `{ latest: { review, at } | null, item, history: { date, review }[] }`; `normalizeQuestion` di payload-schema; endpoint `POST /api/summary-items/[id]/schedule {dueAt, note}` dan `…/drop {note?}` (selalu kirim body JSON, minimal `{}`).

- **ContactPanel:** dua tab di bagian atas panel, "Kontak" (semua isi sekarang, tidak berubah) dan "Ringkasan chat". Gayanya mengikuti tablist yang sudah ada di repo (role="tab", `aria-selected`, border-b accent). Tab terakhir yang dipilih diingat di `localStorage` (try/catch). Ganti percakapan berarti data dimuat ulang.
- **ChatReviewTab:**
  1. **Status tindak lanjut** (paling atas):
     - REPLY OPEN → "Belum dijawab"; FOLLOW_UP OPEN → "Perlu follow up"; SCHEDULED → "Dijadwalkan {dueAt WIB}".
     - DONE → "Sudah ditindaklanjuti" plus alasan: REPLIED "dibalas", REMINDER_DONE "pengingat selesai", STAGE_ADVANCED "tahap pipeline naik".
     - DROPPED → "Dilepas" plus catatan.
     - `item` null → "Tidak ada di antrean".
     - Untuk OPEN/SCHEDULED tampilkan tombol Ingatkan & Lepas, memakai ulang komponen dari SummaryQueue. Setelah sukses, muat ulang dan kirim event `summary-items:changed` (`src/lib/summary-items/events.ts`).
  2. **Poin penting terbaru:**
     - "Diperbarui {at WIB}" dan tombol "Perbarui sekarang" (POST; label saat loading "Meringkas…"; error inline).
     - Badge status review (perlu tindakan / selesai / tidak jelas), topik, dan jenis kontak.
     - Daftar pertanyaan dengan tanda ✅ "terjawab" / ⏳ "belum" (`terjawab: null` → tanpa tanda). Pakai teks/aria, bukan hanya warna.
     - Poin penting (list), "Sudah dijawab tim" = `statusAgen`, "Langkah berikut" = `langkahBerikut`.
     - `latest` null → teks "Belum ada ringkasan." dan tombol Perbarui.
  3. **Riwayat:** satu `<details>` per tanggal (label tanggal WIB, topik, badge status). Isinya pertanyaan/poin dengan format yang sama. Kalau kosong, bagian ini tidak tampil.
- Test (`ChatReviewTab.test.tsx`, mock fetch): label status untuk REPLY/FOLLOW_UP/SCHEDULED/DONE/DROPPED/null; tanda pertanyaan terjawab/belum/legacy string; Perbarui sekarang memanggil POST lalu menampilkan hasil; error 502 tampil inline; riwayat ter-render. ContactPanel: tab berpindah dan tab Kontak tetap menampilkan isi lama (sesuaikan test yang ada).
