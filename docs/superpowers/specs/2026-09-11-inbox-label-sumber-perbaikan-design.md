# Inbox: label topik, sumber jawaban, dan perbaikan dari jawaban bot — Desain

Tanggal: 2026-09-11 · Status: disetujui operator (rancangan A/B/C), menunggu tinjauan spec

## 1. Tujuan

Saat membaca percakapan di Inbox, operator dan agen harus bisa melakukan tiga hal:

1. **Melihat topik dan intent** setiap pesan pelanggan, sebagai label kecil di bawah pesan masuk.
2. **Melihat dari mana jawaban bot berasal**: knowledge atau katalog mana yang dipakai, paragraf mana yang cocok dengan baris mana, topik apa yang dipakai untuk menyaring, knowledge apa yang ditolak, dan hasil verifikasi.
3. **Memperbaiki jawaban langsung dari bubble balasan bot**: mengedit entri knowledge yang dipakai, atau menambah jawaban yang benar. Hasilnya langsung aktif.

## 2. Keputusan operator (2026-09-11)

| Pertanyaan | Jawaban |
|---|---|
| Pesan mana yang diberi label | Pesan yang diproses bot langsung berlabel dari data yang sudah tercatat. Pesan lain punya ikon "cek topik"; teksnya baru dikirim ke model saat diklik. |
| Tombol perbaikan | Panel perbaikan manual: edit entri yang dipakai, atau tambah jawaban yang benar. Simpan = langsung aktif. Jawaban otomatis ditandai. Tanpa AI. |
| Siapa boleh menyimpan dari panel | Semua yang login. CLAUDE.md §6 diamandemen untuk aksi ini saja. |
| Kutipan | Disimpan setiap kali bot menjawab: dari knowledge mana, dan di paragraf mana. |

Tidak termasuk: asisten AI (Claude API), klasifikasi otomatis semua pesan masuk, dan perubahan prompt bot.

## 3. Kondisi kode hari ini

- **Tampilan pesan.** `MessageBubble` (`src/components/inbox/MessageBubble.tsx`) merender pesan masuk dan keluar. Datanya berasal dari `GET /api/conversations/[id]/messages` (`src/app/api/conversations/[id]/messages/route.ts`) lewat `serializeMessage` (`src/lib/serialize-message.ts`). Pembaruan live datang lewat SSE `message.updated` di `src/components/inbox/ThreadView.tsx`.
- **Kaitan pesan dengan keputusan bot.**
  - Pesan masuk TIDAK terhubung ke `BotDecisionRun`. `scheduleBotRun` (`src/lib/inbound.ts`) hanya menerima teks, dan `flushBurst` menggabungkan beberapa pesan beruntun sebelum memanggil `runBotForConversation`.
  - Balasan bot membawa keputusan lengkap di `Message.botTrace`, yang disanitasi oleh `sanitizeTrace` di `src/lib/send.ts`. `BotDecisionRun.messageId` diisi oleh `attachMessageToDecisionRun` (`src/lib/bot-control/decision-recorder.ts`).
- **Popover trace.** `BotTracePopover` (`src/components/inbox/BotTracePopover.tsx`) hanya muncul di pesan dari bot.
  - Yang sudah ditampilkan: mode, langkah, "Fakta yang dipakai" (`catalogLines` + `managedLines`), dan "Fakta yang ditolak".
  - Yang belum ditampilkan: `topic`, `job`, `alsoTopics`, dan `verification`.
- **Sumber knowledge.** Setiap `managedLines[]` di `DecisionKnowledge` (`src/lib/bot/types.ts`) hanya menyimpan `source` berupa teks judul + versi. Tidak ada id sumber, dan tidak ada pemetaan paragraf → baris.
- **Perbaikan.**
  - `POST /api/bot-control/decisions/[id]/flag` terbuka untuk semua yang login.
  - `POST /api/bot-control/decisions/[id]/create-knowledge-draft` khusus `hasAdminPowers` dan hanya membuat DRAFT.
  - Keduanya hanya dipanggil dari halaman Decision Logs lewat `window.prompt`. Di Inbox tidak ada tombol perbaikan.
- **Jalur tulis knowledge.** `createManagedKnowledge`, `saveKnowledgeDraft`, dan `publishKnowledgeRevision` ada di `src/lib/bot-control/knowledge-workflow.ts`.
  - `publishKnowledgeRevision` sudah menulis audit `PUBLISH` lewat `writeBotAuditLog`.
  - Topik terisi otomatis lewat `fillMissingTopics`.
  - Editornya adalah `KnowledgeEditor` (`src/components/bot-control/KnowledgeEditor.tsx`), dengan tombol "Simpan draft" dan "Simpan & aktifkan", dan alasan minimal 10 karakter.
- **Pengklasifikasi.**
  - `classifyTopicViaLLM` (`src/lib/bot/topic-classifier.ts`) dan `classifyAllTopics` (`src/lib/bot/multi-topic-classifier.ts`) memakai model.
  - `classifySalesNeed` (`src/lib/bot/sales-classifier.ts`) sinkron dan berbasis aturan kata (job J1–J5).

## 4. Rancangan

### A. Data

**A1. Label di pesan masuk: kolom `Message.topicLabels` (`Json?`, migrasi aditif).**

Kolom ini hanya diisi untuk pesan `INBOUND`. Bentuknya (tipe `TopicLabels` di modul baru `src/lib/inbox/topic-labels.ts`):

```ts
type TopicLabels = {
  topic: ResolverTopic            // topik utama
  alsoTopics: ResolverTopic[]     // topik tambahan (Task 22), boleh kosong
  job: SalesClassification['job'] // J1–J5 dari classifySalesNeed
  topicSource: 'llm' | 'regex_fallback'
  source: 'bot' | 'manual'
  decisionRunId?: string          // hanya untuk source 'bot'
  at: string                      // ISO
}
```

- **Jalur bot.**
  - `scheduleBotRun` menerima id pesan masuk (parameter baru, opsional) dan mengumpulkannya di burst bersama teksnya.
  - `flushBurst` meneruskan daftar id itu ke `runBotForConversation`.
  - Setelah keputusan selesai dan membawa `topic`, satu penulis (`writeInboundTopicLabels`, modul baru `src/lib/inbox/topic-labels.ts`) menulis label yang sama ke SEMUA pesan masuk di burst itu, lalu memancarkan `message.updated`.
  - Keputusan tanpa `topic` tidak menulis label: Mode 3 `booking_context`, handoff sebelum klasifikasi, dan error.
  - Route test-message ikut meneruskan id pesannya.
- **Jalur manual.** Route `POST /api/conversations/[id]/messages/[messageId]/topic-labels`:
  - Hanya untuk yang login.
  - Pesan harus `INBOUND`, berteks, dan milik percakapan tersebut.
  - Kalau `topicLabels` sudah ada, route mengembalikannya tanpa memanggil model.
  - Kalau belum ada, route menjalankan `classifyTopicViaLLM(null, teks, model)` dan `classifyAllTopics(teks, model)` paralel, ditambah `classifySalesNeed({ message: teks, tripBrief: {} })`.
  - Hasilnya disimpan dengan `source: 'manual'` dan dipancarkan lewat `message.updated`.
  - Hanya teks pesan yang diklik yang dikirim ke model.

**A2. Sumber di balasan bot.**

- **Id sumber per baris.** Setiap `managedLines[]` bertambah `sourceId`, `sourceKey`, dan `version`, dari entri knowledge yang dimuat `src/lib/bot/managed-knowledge.ts` dan diteruskan `managedFactsFor` (`src/lib/bot/runtime-integration.ts`). `source` teks tetap ada supaya kompatibel.
- **Pemetaan paragraf.** `DecisionKnowledge` bertambah `attributions?: Array<{ paragraph: number; lines: Array<{ kind: 'managed' | 'catalog'; line: string; sourceId?: string; title?: string; version?: number }> }>`.
  - Dihitung oleh fungsi murni `attributeReply(replyText, knowledge)` di modul baru `src/lib/bot/reply-attribution.ts`.
  - Balasan final dipecah per paragraf, yaitu per baris kosong atau per butir.
  - Sebuah baris knowledge atau katalog dianggap cocok dengan paragraf bila keduanya memuat nominal Rupiah atau URL yang sama, atau berbagi kata isi di atas ambang yang ditetapkan di modul itu.
  - Deterministik, tanpa panggilan model.
- **Satu titik hitung.** Pemetaan dihitung sekali di titik tempel tunggal `attachClassification` (`src/lib/bot/orchestrator.ts`), atas teks balasan FINAL setelah verifier. Dengan begitu `Message.botTrace` dan `BotDecisionRun.knowledgeRefs` (`knowledgeRefsForDecision`) membawa data yang sama, dan keduanya tetap lewat `sanitizeTrace`.
- **Balasan lama** tidak punya `attributions`. UI menampilkan "tidak tercatat".
- **Kejujuran label.** Pemetaan ini hasil pencocokan sistem, bukan pernyataan model. UI menulisnya sebagai "cocok dengan", bukan "dikutip".

### B. Tampilan di Inbox

**B1. Chip di bawah pesan masuk.**

- `serializeMessage` menyertakan `topicLabels`.
- `MessageBubble` merender chip kecil untuk pesan `INBOUND`: topik utama, topik tambahan (gaya lebih tipis), dan intent.
- Nama tampilan untuk ke-14 topik dan J1–J5 ada di modul baru `src/lib/inbox/label-names.ts`, dalam Bahasa Indonesia, misalnya J2 → "Harga & nilai".
- Label hasil `regex_fallback` diberi tanda "perkiraan".
- Kalau `topicLabels` kosong dan pesan berteks, yang tampil ikon "Cek topik". Saat diklik, status berubah menjadi memuat, lalu chip atau pesan galat muncul di tempat.

**B2. Di balasan bot.**

- **Popover Sumber** (`BotTracePopover`, diperluas) menambah bagian-bagian ini:
  - "Topik": utama, tambahan, dan intent.
  - "Sumber per paragraf": dari `attributions`, berisi potongan paragraf → judul entri vN, atau "Katalog".
  - Versi di setiap baris "Fakta yang dipakai".
  - "Verifikasi": status, harga yang tidak bersumber, dan URL yang tidak dikenal.
- **Ikon Perbaiki** (baru, di samping ikon trace) membuka `FixAnswerPanel` (komponen baru `src/components/inbox/FixAnswerPanel.tsx`, berbentuk `Modal`). Isinya:
  - Pertanyaan pelanggan (`inboundText` run) dan jawaban bot.
  - "Knowledge yang dipakai": entri unik per `sourceId`. Masing-masing punya tombol **Edit** yang membuka `KnowledgeEditor`, terisi dari revisi PUBLISHED terkini entri itu.
  - **"Tambah jawaban yang benar"** membuka `KnowledgeEditor` dengan satu item `{ question: inboundText, answer: '' }`.
  - Di panel ini `KnowledgeEditor` hanya menampilkan tombol "Simpan & aktifkan".
  - Setelah berhasil, panel menampilkan "Aktif: <judul> v<N>", dan jawaban bot tertanda "perlu diperbaiki".

### C. Aturan dan pengaman

**C1. Route perbaikan: `POST /api/inbox/decisions/[id]/fix`.**

- `getSession` wajib; semua peran yang login boleh.
- Body divalidasi Zod sebagai union:
  - `{ kind: 'edit', sourceId, title, summary, items, reason }`
  - `{ kind: 'new', title, summary, items, reason }`
  - `reason` minimal 10 karakter, sama dengan `KnowledgeEditor`.
  - `items` tidak boleh kosong.
- `edit` menjalankan `saveKnowledgeDraft` lalu `publishKnowledgeRevision`. `new` menjalankan `createManagedKnowledge` lalu `publishKnowledgeRevision`. Aktor = akun sesi.
- Audit `PUBLISH` sudah ditulis oleh `publishKnowledgeRevision`, dengan `reason` lewat `sanitizeTrace` sesuai CLAUDE.md §4.
- Setelah revisi terbit, run ditandai: `flaggedAt` = sekarang, `flagNote` = `reason`.
  - Kalau penandaan gagal, revisi tetap aktif, dan respons melaporkan `flagged: false`. Penandaan hanyalah metadata triase.
- Penjaga tipe `MANUAL` di `knowledge-workflow.ts` tidak dilonggarkan.
- Galat selalu berbentuk `{ error: string }`.

**C2. Pembaca revisi untuk editor: `GET /api/inbox/knowledge/[sourceId]`.**

- Terbuka untuk yang login.
- Mengembalikan `{ title, summary, items, version }` dari revisi PUBLISHED terkini, supaya panel tidak bergantung pada route knowledge yang khusus admin.

**C3. Amandemen CLAUDE.md §6.**

Satu kalimat pengecualian: perbaikan knowledge dari Inbox (C1) terbuka untuk semua yang login, karena setiap simpan berversi, dapat dikembalikan, dan tercatat di audit log. Route knowledge lainnya tetap lewat `hasAdminPowers`.

**C4. Migrasi.**

`Message.topicLabels Json?` dibuat offline dengan `prisma migrate diff`, lalu diterapkan dengan `prisma migrate deploy` (CLAUDE.md §7). Migrasi ini hanya menambah kolom (tanpa `DROP` atau `ALTER` non-aditif).

## 5. Pengujian

- **`attributeReply`:** kecocokan lewat nominal Rupiah, URL, kata isi, dan kasus tidak ada yang cocok.
- **Penulis label jalur bot:** semua pesan di satu burst mendapat label yang sama; tidak ada label saat keputusan tanpa `topic`.
- **Route `topic-labels`:** 401 tanpa sesi; 404 bila pesan bukan milik percakapan; 400 bila pesan bukan `INBOUND` atau tanpa teks; label yang sudah ada dikembalikan tanpa memanggil model; `regex_fallback` tercatat.
- **Route `fix`:**
  - 401 tanpa sesi; peran AGENT diizinkan; 400 lewat Zod.
  - `edit` dan `new` menerbitkan revisi, dan audit `PUBLISH` ditulis.
  - Run tertandai. Kalau penandaan gagal, respons `flagged: false` dan revisi tetap aktif.
  - Penjaga `MANUAL` utuh.
- **Komponen:**
  - chip `MessageBubble` beserta ikon "Cek topik";
  - bagian baru `BotTracePopover`;
  - `FixAnswerPanel`: kedua jalur dan tampilan galat.
- **Kompatibilitas:** `managedLines` lama yang tanpa `sourceId` tetap dirender, tetapi tanpa tombol Edit.
- **Simulator:** tidak berubah. Test yang membuktikan simulator tidak memanggil `sendMessage` tetap hijau.
- **Gerbang umum:** `npm test`, `npx tsc --noEmit`, `npx eslint .`.

## 6. Risiko

- **Pencocokan paragraf bisa meleset**, karena berbasis kata. Mitigasinya label "cocok dengan", dan rincian baris selalu bisa dibuka.
- **Semua yang login bisa mengubah perilaku bot seketika.** Mitigasinya: versi, audit (siapa dan alasan), dan revisi bisa dikembalikan dari halaman Knowledge.
- **"Cek topik" mengirim teks pesan ke model cloud** (`gemma4:31b-cloud`). Pengiriman hanya terjadi saat diklik, dan hanya pesan itu.
