# Inbox: label topik, sumber jawaban, dan perbaikan dari jawaban bot — Desain

Tanggal: 2026-09-11 · Status: disetujui operator (rancangan A/B/C; A1 direvisi operator: klasifikasi otomatis pesan baru), menunggu tinjauan spec

## 1. Tujuan

Saat membaca percakapan di Inbox, operator dan agen harus bisa melakukan tiga hal:

1. **Melihat topik dan intent** setiap pesan pelanggan, sebagai label kecil di bawah pesan masuk.
2. **Melihat dari mana jawaban bot berasal**: knowledge atau katalog mana yang dipakai, paragraf mana yang cocok dengan baris mana, topik apa yang dipakai untuk menyaring, knowledge apa yang ditolak, dan hasil verifikasi.
3. **Memperbaiki jawaban langsung dari bubble balasan bot**: mengedit entri knowledge yang dipakai, atau menambah jawaban yang benar. Hasilnya langsung aktif.

## 2. Keputusan operator (2026-09-11)

| Pertanyaan | Jawaban |
|---|---|
| Pesan mana yang diberi label | Setiap pesan masuk BARU diklasifikasi otomatis saat tiba. Pesan lama tidak di-backfill. Pesan tanpa label (pesan lama, atau klasifikasinya gagal) punya ikon "Cek topik"; teksnya baru dikirim ke model saat diklik. |
| Tombol perbaikan | Panel perbaikan manual: edit entri yang dipakai, atau tambah jawaban yang benar. Simpan = langsung aktif. Jawaban otomatis ditandai. Tanpa AI. |
| Siapa boleh menyimpan dari panel | Semua yang login. CLAUDE.md §6 diamandemen untuk aksi ini saja. |
| Kutipan | Disimpan setiap kali bot menjawab: dari knowledge mana, dan di paragraf mana. |

Tidak termasuk: asisten AI (Claude API), backfill label untuk pesan lama, dan perubahan prompt bot.

## 3. Kondisi kode hari ini

- **Tampilan pesan.**
  - `MessageBubble` (`src/components/inbox/MessageBubble.tsx`) merender pesan masuk dan pesan keluar.
  - Datanya berasal dari `GET /api/conversations/[id]/messages` (`src/app/api/conversations/[id]/messages/route.ts`) lewat `serializeMessage` (`src/lib/serialize-message.ts`).
  - Pembaruan live datang lewat SSE `message.updated` di `src/components/inbox/ThreadView.tsx`.
- **Pesan masuk.**
  - Baris pesan masuk dibuat oleh `ingestSingleMessage` (`src/lib/inbound.ts`).
  - Bot hanya berjalan bila percakapannya ber-bot. `scheduleBotRun` dan `flushBurst` menggabungkan beberapa pesan beruntun, lalu memanggil `runBotForConversation`.
  - Pesan masuk tidak terhubung ke `BotDecisionRun`.
- **Jejak keputusan bot.**
  - Balasan bot membawa keputusan lengkap di `Message.botTrace`, yang disanitasi oleh `sanitizeTrace` di `src/lib/send.ts`.
  - `BotDecisionRun.messageId` diisi oleh `attachMessageToDecisionRun` (`src/lib/bot-control/decision-recorder.ts`).
- **Popover trace.**
  - `BotTracePopover` (`src/components/inbox/BotTracePopover.tsx`) hanya muncul di pesan dari bot.
  - Yang sudah ditampilkan: mode, langkah, "Fakta yang dipakai" (`catalogLines` + `managedLines`), dan "Fakta yang ditolak".
  - Yang belum ditampilkan: `topic`, `job`, `alsoTopics`, dan `verification`.
- **Sumber knowledge.**
  - Setiap `managedLines[]` di `DecisionKnowledge` (`src/lib/bot/types.ts`) hanya menyimpan `source` berupa teks judul + versi.
  - Tidak ada id sumber, dan tidak ada pemetaan paragraf → baris.
- **Perbaikan.**
  - `POST /api/bot-control/decisions/[id]/flag` terbuka untuk semua yang login.
  - `POST /api/bot-control/decisions/[id]/create-knowledge-draft` khusus `hasAdminPowers`, dan hanya membuat DRAFT.
  - Keduanya hanya dipanggil dari halaman Decision Logs lewat `window.prompt`. Di Inbox tidak ada tombol perbaikan.
- **Jalur tulis knowledge.**
  - Fungsinya ada di `src/lib/bot-control/knowledge-workflow.ts`: `createManagedKnowledge`, `saveKnowledgeDraft`, dan `publishKnowledgeRevision`.
  - `publishKnowledgeRevision` sudah menulis audit `PUBLISH` lewat `writeBotAuditLog`. Topik terisi otomatis lewat `fillMissingTopics`.
  - Editornya `KnowledgeEditor` (`src/components/bot-control/KnowledgeEditor.tsx`): tombol "Simpan draft" dan "Simpan & aktifkan", alasan minimal 10 karakter.
- **Pengklasifikasi.**
  - `classifyTopicViaLLM` (`src/lib/bot/topic-classifier.ts`) dan `classifyAllTopics` (`src/lib/bot/multi-topic-classifier.ts`) memakai model.
  - `classifySalesNeed` (`src/lib/bot/sales-classifier.ts`) sinkron dan berbasis aturan kata. Keluarannya `SalesClassification`, dengan `job` J1–J5.

## 4. Rancangan

### A. Data

**A1. Label di pesan masuk: kolom `Message.topicLabels` (`Json?`, migrasi aditif).**

Kolom ini hanya diisi untuk pesan `INBOUND` yang berteks. Bentuknya adalah tipe `TopicLabels`, di modul baru `src/lib/inbox/topic-labels.ts`:

```ts
type TopicLabels = {
  topic: ResolverTopic            // topik utama pesan ini
  alsoTopics: ResolverTopic[]     // topik tambahan (Task 22), boleh kosong
  job: SalesClassification['job'] // J1–J5 dari classifySalesNeed
  topicSource: 'llm' | 'regex_fallback'
  source: 'auto' | 'manual'
  at: string                      // ISO
}
```

Satu fungsi, `classifyAndStoreTopicLabels(messageId, source)` di modul baru `src/lib/inbox/topic-labels.ts`, dipakai oleh kedua jalur di bawah. Urutan kerjanya:

1. Baca pesannya, lalu jalankan `classifyTopicViaLLM(null, teks, model)` dan `classifyAllTopics(teks, model)` secara paralel, ditambah `classifySalesNeed({ message: teks, tripBrief: {} })`.
2. Buang topik utama dari `alsoTopics`.
3. Simpan hasilnya ke `topicLabels`, lalu pancarkan `message.updated`.
4. Model yang dipakai sama dengan bot: `Settings.ollamaModel`.

**Jalur otomatis.**

- Sesudah `ingestSingleMessage` membuat baris pesan `INBOUND` yang berteks, fungsi di atas dipanggil dengan `'auto'` tanpa ditunggu (fire-and-forget). Webhook dan bot tidak menunggunya.
- Berlaku untuk semua percakapan, ber-bot atau tidak, termasuk nomor Indonesia dan percakapan sandbox (route test-message). Pesan media tanpa teks tidak diklasifikasi.
- Kalau model gagal (timeout atau galat): `classifyTopicViaLLM` jatuh ke `regex_fallback` sesuai perilakunya sendiri, dan `classifyAllTopics` gagal-terbuka ke `[]`.
- Kalau pembacaan atau penyimpanan gagal, galat dicatat (`console.error`), pesan tetap tanpa label, dan ikon "Cek topik" muncul.
- Pesan yang sudah ada sebelum rilis tidak disentuh.

**Jalur manual.** Route `POST /api/conversations/[id]/messages/[messageId]/topic-labels`:

- Hanya untuk yang login.
- Pesan harus `INBOUND`, berteks, dan milik percakapan tersebut.
- Kalau `topicLabels` sudah ada, route mengembalikannya tanpa memanggil model.
- Kalau belum ada, route menjalankan fungsi yang sama dengan `'manual'` dan menunggu hasilnya.

Label di pesan masuk mencerminkan pesan itu sendiri. Topik giliran bot, yang bisa menggabungkan beberapa pesan beruntun, tetap terlihat di popover balasan bot (B2).

**A2. Sumber di balasan bot.**

- **Id sumber per baris.** Setiap `managedLines[]` bertambah `sourceId`, `sourceKey`, dan `version`.
  - Nilainya diambil dari entri knowledge yang dimuat `src/lib/bot/managed-knowledge.ts`, lalu diteruskan `managedFactsFor` (`src/lib/bot/runtime-integration.ts`).
  - `source` teks tetap ada supaya kompatibel.
- **Pemetaan paragraf.** `DecisionKnowledge` bertambah field ini:

  ```ts
  attributions?: Array<{
    paragraph: number
    lines: Array<{
      kind: 'managed' | 'catalog'
      line: string
      sourceId?: string
      title?: string
      version?: number
    }>
  }>
  ```

  - Dihitung oleh fungsi murni `attributeReply(replyText, knowledge)`, di modul baru `src/lib/bot/reply-attribution.ts`.
  - Balasan final dipecah per paragraf, yaitu per baris kosong atau per butir.
  - Sebuah baris knowledge atau katalog dianggap cocok dengan paragraf kalau memuat nominal Rupiah atau URL yang sama, atau berbagi kata isi di atas ambang yang ditetapkan di modul itu.
  - Deterministik, tanpa panggilan model.
- **Tempat hitung.** Pemetaan dihitung sekali di titik tempel tunggal `attachClassification` (`src/lib/bot/orchestrator.ts`), atas teks balasan FINAL setelah verifier.
  - Dengan begitu `Message.botTrace` dan `BotDecisionRun.knowledgeRefs` (`knowledgeRefsForDecision`) membawa data yang sama.
  - Keduanya tetap lewat `sanitizeTrace`.
- **Balasan lama** tidak punya `attributions`, dan UI menampilkan "tidak tercatat".
- **Kejujuran label.** Pemetaan ini hasil pencocokan sistem, bukan pernyataan model. UI menulisnya sebagai "cocok dengan", bukan "dikutip".

### B. Tampilan di Inbox

**B1. Chip di bawah pesan masuk.**

- `serializeMessage` menyertakan `topicLabels`.
- `MessageBubble` merender chip kecil untuk pesan `INBOUND`: topik utama, topik tambahan dengan gaya lebih tipis, dan intent.
- Nama tampilan untuk ke-14 topik dan J1–J5 ada di modul baru `src/lib/inbox/label-names.ts`, dalam Bahasa Indonesia, misalnya J2 → "Harga & nilai".
- Label hasil `regex_fallback` diberi tanda "perkiraan".
- Label yang tiba lewat `message.updated` langsung tampil tanpa muat ulang.
- Kalau `topicLabels` kosong dan pesan berteks, tampil ikon "Cek topik". Saat diklik, ikon berganti status memuat, lalu chip atau pesan galat muncul di tempat.

**B2. Di balasan bot.**

- **Popover Sumber** (`BotTracePopover`, diperluas) mendapat tambahan berikut:
  - bagian "Topik": topik utama giliran bot, topik tambahan, dan intent;
  - bagian "Sumber per paragraf" dari `attributions`: potongan paragraf → judul entri vN, atau "Katalog";
  - versi di setiap baris "Fakta yang dipakai";
  - bagian "Verifikasi": status, harga yang tidak bersumber, dan URL yang tidak dikenal.
- **Ikon Perbaiki** (baru, di samping ikon trace) membuka `FixAnswerPanel`, komponen baru `src/components/inbox/FixAnswerPanel.tsx` berbentuk `Modal`. Isinya:
  - pertanyaan pelanggan (`inboundText` run) dan jawaban bot;
  - "Knowledge yang dipakai": entri unik per `sourceId`, masing-masing dengan tombol **Edit** yang membuka `KnowledgeEditor` terisi dari revisi PUBLISHED terkini entri itu;
  - tombol **"Tambah jawaban yang benar"**, yang membuka `KnowledgeEditor` dengan satu item `{ question: inboundText, answer: '' }`.
- Di panel ini `KnowledgeEditor` hanya menampilkan tombol "Simpan & aktifkan".
- Setelah berhasil, panel menampilkan "Aktif: <judul> v<N>", dan jawaban bot tertanda "perlu diperbaiki".

### C. Aturan dan pengaman

**C1. Route perbaikan `POST /api/inbox/decisions/[id]/fix`.**

- `getSession` wajib, dan semua peran yang login boleh memakainya.
- Body divalidasi Zod sebagai union:
  - `{ kind: 'edit', sourceId, title, summary, items, reason }`
  - `{ kind: 'new', title, summary, items, reason }`
  - `reason` minimal 10 karakter, sama dengan `KnowledgeEditor`.
  - `items` tidak boleh kosong.
- Jalur `edit` memanggil `saveKnowledgeDraft`, lalu `publishKnowledgeRevision`.
- Jalur `new` memanggil `createManagedKnowledge`, lalu `publishKnowledgeRevision`.
- Aktornya akun sesi.
- Audit `PUBLISH` sudah ditulis oleh `publishKnowledgeRevision`, dan `reason` lewat `sanitizeTrace` sesuai CLAUDE.md §4.
- Setelah revisi terbit, run ditandai: `flaggedAt` = sekarang, `flagNote` = `reason`.
  - Kalau penandaan gagal, revisi tetap aktif dan respons melaporkan `flagged: false`.
  - Alasannya, penandaan hanyalah metadata triase.
- Penjaga tipe `MANUAL` di `knowledge-workflow.ts` tidak dilonggarkan.
- Galat selalu berbentuk `{ error: string }`.

**C2. Pembaca revisi untuk editor `GET /api/inbox/knowledge/[sourceId]`.**

- Terbuka untuk yang login.
- Mengembalikan `{ title, summary, items, version }` dari revisi PUBLISHED terkini.
- Dengan begitu panel tidak bergantung pada route knowledge yang khusus admin.

**C3. Amandemen CLAUDE.md §6.**

Satu kalimat pengecualian: perbaikan knowledge dari Inbox (C1) terbuka untuk semua yang login, karena setiap simpan berversi, dapat dikembalikan, dan tercatat di audit log. Route knowledge lainnya tetap lewat `hasAdminPowers`.

**C4. Migrasi.**

- `Message.topicLabels Json?` dibuat offline dengan `prisma migrate diff`, lalu diterapkan dengan `prisma migrate deploy` (CLAUDE.md §7).
- Migrasi ini hanya menambah kolom: tanpa `DROP`, dan tanpa `ALTER` non-aditif.
- Kode deploy SESUDAH migrasi, karena `ingestSingleMessage` akan menulis kolom itu.

## 5. Pengujian

- **`classifyAndStoreTopicLabels`:**
  - hasil disimpan dengan `source` yang benar;
  - topik utama dibuang dari `alsoTopics`;
  - `regex_fallback` tercatat;
  - galat baca atau simpan dicatat, tanpa melempar.
- **Jalur otomatis di `ingestSingleMessage`:**
  - dipanggil untuk `INBOUND` berteks, termasuk percakapan tanpa bot;
  - tidak dipanggil untuk pesan media tanpa teks;
  - kegagalannya tidak menggagalkan ingest dan tidak menahan bot.
- **Route `topic-labels`:**
  - 401 tanpa sesi;
  - 404 bila pesan bukan milik percakapan;
  - 400 bila bukan `INBOUND` atau tanpa teks;
  - label yang sudah ada dikembalikan tanpa memanggil model.
- **`attributeReply`:** kecocokan lewat nominal Rupiah, URL, kata isi, dan kasus tanpa kecocokan.
- **Route `fix`:**
  - 401 tanpa sesi; peran AGENT diizinkan; 400 lewat Zod;
  - `edit` dan `new` menerbitkan revisi, dan audit `PUBLISH` tertulis;
  - run tertandai; kalau penandaan gagal, respons `flagged: false` dan revisi tetap aktif;
  - penjaga `MANUAL` tetap utuh.
- **Komponen:**
  - chip `MessageBubble`, termasuk ikon "Cek topik" dan label yang tiba lewat SSE;
  - bagian baru `BotTracePopover`;
  - `FixAnswerPanel`: kedua jalur dan tampilan galat.
- **Kompatibilitas:** `managedLines` lama tanpa `sourceId` tetap dirender, tetapi tanpa tombol Edit.
- **Simulator:** tidak berubah. Test bahwa simulator tidak memanggil `sendMessage` tetap hijau.
- **Gerbang umum:** `npm test`, `npx tsc --noEmit`, `npx eslint .`.

## 6. Risiko

- **Semua teks pesan pelanggan baru dikirim ke model cloud** (`gemma4:31b-cloud`, diproses di ollama.com), termasuk percakapan yang tidak dijawab bot dan nomor Indonesia. Keputusan operator 2026-09-11. Hari ini hanya percakapan ber-bot yang dikirim. Pesan lama tidak dikirim.
- **Biaya dan beban:** +2 panggilan model per pesan masuk. Panggilan ini berjalan bersamaan dengan panggilan bot pada percakapan ber-bot. Kalau model lambat atau gagal, labelnya saja yang tertunda atau hilang, sedangkan bot tidak menunggu.
- **Pencocokan paragraf bisa meleset**, karena berbasis kata. Mitigasinya: label ditulis "cocok dengan", dan rincian baris selalu bisa dibuka.
- **Semua yang login bisa mengubah perilaku bot seketika.** Mitigasinya: versi, audit (siapa dan alasan), dan revisi yang bisa dikembalikan dari halaman Knowledge.
