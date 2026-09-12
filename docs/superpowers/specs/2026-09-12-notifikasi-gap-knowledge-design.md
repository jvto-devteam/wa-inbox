# Notifikasi gap knowledge, lompat ke jawaban, dan uji ulang — Desain

Tanggal: 2026-09-12 · Status: disetujui operator (empat keputusan di §2), menunggu tinjauan spec

## 1. Tujuan

Ketika bot menjawab tanpa bersandar pada knowledge mana pun, operator harus (a) diberi tahu tanpa membuka halaman khusus, (b) dibawa langsung ke jawaban itu, (c) bisa memperbaikinya di tempat, dan (d) melihat jawaban barunya diuji ulang sebelum menyatakan selesai.

Bangunan ini menyambung yang sudah ada — `KnowledgeGapLog`, panel perbaikan di Inbox, dan `runSimulation` — bukan membangun mekanisme notifikasi baru.

## 2. Keputusan operator (2026-09-12)

| Pertanyaan | Jawaban |
|---|---|
| Isi lonceng | Hanya gap knowledge. Handoff tetap memakai kanal lamanya (suara + notifikasi browser), tidak masuk lonceng. |
| Tempat baris gap ditulis | Sesudah balasan terkirim, di `inbound.ts`, tempat id percakapan + id pesan + id keputusan semuanya ada. Dua sinyal gap lama tidak dipindahkan. |
| Penutupan gap | Kolom `resolvedAt`. Otomatis saat operator menjawab "sudah sesuai" pada uji ulang, plus tombol "Tandai selesai" di daftar. |
| Akses uji ulang | Route baru di bawah `/api/inbox`, terbuka untuk semua yang login, memanggil `runSimulation` yang sama. Test Lab di Bot Control tetap khusus admin. |

**Revisi keputusan ketiga.** Semula "otomatis saat perbaikan disimpan". Permintaan uji ulang mengubahnya: menyimpan revisi bukan bukti jawaban sudah benar, jadi yang menutup gap adalah konfirmasi operator setelah melihat jawaban baru. Menyimpan lalu menutup panel meninggalkan gap tetap terbuka — memang begitu yang benar, karena belum ada yang memeriksanya.

Tidak termasuk: paginasi/pengelompokan/penyaring di dropdown, notifikasi untuk pesan masuk yang gagal diberi label topik, perubahan pada dua titik gap lama, dan perubahan pada Test Lab.

## 3. Kondisi kode hari ini (terverifikasi 2026-09-12)

- **`KnowledgeGapLog`** (`prisma/schema.prisma`): `id`, `conversationId`, `topic`, `reason`, `messageText`, `createdAt`. Tidak ada id pesan, id run, maupun penanda selesai.
- **Penulisnya** `recordKnowledgeGap` (`src/lib/bot/orchestrator.ts:1334`), dipanggil tiga kali: `verification_failed` (dari `composeVerifiedReply`, `:811`) dan `no_facts_resolved` (`:1291`, `:2058`). Topik `greeting` dikecualikan. Ketiganya `void` (tidak ditunggu) dan tidak tahu id pesan — pada saat itu balasannya memang belum dibuat.
- **Data produksi:** 3 baris gap sepanjang sejarah (semua `no_facts_resolved`, topik `route_endpoint`, 2026-09-09), nol `verification_failed`. 72 pesan bot sejak 2026-07-27, satu di antaranya membawa `knowledge` di `botTrace`. 21 `BotDecisionRun` (13 mode faq). **Lonceng ini akan sepi, dan tingkat kemunculan sinyal barunya belum bisa diukur dari masa lalu.**
- **Pembaca gap:** `GET /api/bot/knowledge-gaps` (tanpa penjaga sesi di route — sengaja, mengandalkan `src/middleware.ts`, seperti seluruh `/api/bot/*`), halaman `/settings/knowledge-gaps`, dan panel di Beranda.
- **Titik tempel tunggal** `attachClassification` (`orchestrator.ts:2432`) sudah menghitung `attributions` lewat `withAttributions`. Di sinilah status sumber bisa ditentukan tanpa menyentuh cabang mana pun.
- **`inbound.ts`**: `recordBotDecisionRun` memberi `decisionRunId` (`:407`), lalu setelah `sendMessage` dipanggil `attachMessageToDecisionRun(decisionRunId, sent?.id, ...)` (`:445` untuk faq/booking_context/clarify, `:474` untuk handoff).
- **`AppRail`** (`src/components/AppRail.tsx`): tujuh tujuan, tanpa pola lencana; rail `w-16` dari md ke atas, bar bawah `h-14` yang barisnya sengaja menggulung mendatar di ponsel. Menu akun di bawah sudah memakai pola dropdown (`useRef` + klik di luar menutup).
- **`NotificationListener`**: komponen tak terlihat (`return null`), `EventSource` sendiri, hanya menangani `handoff.alert`.
- **Inbox**: `?conversation=<id>` dibaca sekali saat mount sebagai state awal (`src/app/(authenticated)/inbox/page.tsx`), pola yang sudah dipakai widget Beranda. `ThreadView` menggulung sekali ke pembatas "belum dibaca" atau ke bawah. `MessageBubble` menyimpan `showFix` sebagai state internal.
- **`runSimulation`** (`src/lib/bot-control/simulator.ts:106`): menyalin `tripBrief` percakapan asli ke sandbox, menjalankan orchestrator di sana, mengembalikan sandbox seperti semula, dan menghapus baris gap yang dibuat simulasi. Dilarang mengirim (dijaga test). `ensureFreshBookingData` mengembalikan null untuk percakapan `isTest`. `SimulationResult` membawa `mode`, `reply`, `status`, `flowSteps`, `knowledgeRefs: { sourceTopic? }`, `verification`, `warnings`, `wouldSendViaChannel`, `decisionRunId`, `latencyMs` — **tidak** membawa `knowledge`.
- **`POST /api/bot-control/simulate`**: khusus admin (403 untuk selain admin).

## 4. Rancangan

### A. Sinyal

Di `attachClassification`, setiap keputusan mode `faq` yang membawa `knowledge` diberi satu status turunan (tidak disimpan sebagai kolom, cukup dihitung ulang di titik tulis):

- **bersumber** — `attributions` memuat setidaknya satu paragraf yang cocok;
- **tidak bersumber** — ada baris knowledge/katalog, tetapi `attributions` kosong.

Mode `clarify`, `handoff`, dan `booking_context` tidak pernah ditandai: klarifikasi dan salam memang tidak butuh fakta, dan Mode 3 menjawab dari data booking.

Kasus "tidak ada fakta sama sekali" **tidak** ditulis ulang di sini — `no_facts_resolved` yang sudah ada sudah mencatatnya, dan menulisnya dua kali akan menghasilkan dua baris untuk satu giliran.

### B. Data

`KnowledgeGapLog` bertambah tiga kolom nullable dan satu index (migrasi aditif, dibuat offline sesuai CLAUDE.md §7):

- `messageId String?` — pesan balasan bot yang bermasalah;
- `runId String?` — `BotDecisionRun` giliran itu, dipakai route perbaikan untuk menutup gap;
- `resolvedAt DateTime?` — kosong berarti masih terbuka;
- `@@index([resolvedAt])` untuk hitungan lencana.

Baris lama tetap sah: ketiganya kosong, dan UI menanganinya (lihat §4D).

### C. Titik tulis

Di `inbound.ts`, tepat setelah `attachMessageToDecisionRun` pada cabang faq/booking_context/clarify: bila keputusannya mode `faq` dan statusnya **tidak bersumber**, satu baris gap ditulis dengan `reason: 'reply_unsourced'`, membawa `conversationId`, `messageId`, `runId`, `topic` (dari `decision.topic ?? sourceTopic`), dan `messageText` (teks pertanyaan pelanggan). Penulisannya tidak ditunggu dan galatnya hanya dicatat — sama seperti `recordKnowledgeGap` yang sudah ada. Lalu satu event `knowledge.gap` dipancarkan lewat `broadcast` supaya lencana naik seketika.

### D. Lonceng dan perjalanan

Komponen baru `GapBell` di dalam `AppRail`, dengan `EventSource` sendiri (pola yang sama dengan `ConversationList`, `ThreadView`, dan `NotificationListener`). Ia memuat hitungan + lima terbaru saat mount, lalu menaikkan hitungannya pada event `knowledge.gap`.

- **Lencana**: jumlah gap yang `resolvedAt`-nya kosong, ditulis `99+` di atas 99. Tanpa gap, lonceng tampil polos tanpa angka.
- **Dropdown**: lima terbaru — nama kontak, topik, potongan pertanyaan, dan waktu. Tombol **Lihat semua** menuju `/settings/knowledge-gaps` yang sudah ada.
- **Klik satu item**: menuju `/inbox?conversation=<id>&message=<id>`. `ThreadView` menggulung ke pesan itu (mendahului pembatas "belum dibaca"), gelembungnya disorot, dan panel perbaikan terbuka sendiri.
- **Baris gap lama** (tanpa `messageId`) tetap muncul di dropdown, tetapi hanya membuka percakapannya — tanpa sorotan dan tanpa panel. Tiga baris yang ada di produksi persis kasus ini.
- **Di ponsel** lonceng menjadi tujuan kedelapan di baris yang memang sudah dirancang menggulung mendatar. Menyembunyikannya di balik "Lainnya" bertentangan dengan alasan yang tertulis di berkas itu sendiri.

Perubahan penunjang: `MessageBubble` mendapat prop `autoOpenFix?: boolean` (tanpa prop, perilakunya tidak berubah), `ThreadView` mendapat `focusMessageId?: string`, dan halaman Inbox membaca `?message=` sekali saat mount seperti `?conversation=`.

### E. Uji ulang

Route baru `POST /api/inbox/retest` — `getSession` saja, Zod `{ message: string; conversationId: string }` — memanggil `runSimulation({ message, conversationId, useExistingHistory: true })`. `SimulationResult` bertambah satu field `knowledge: DecisionKnowledge | null` (diambil apa adanya dari keputusan), yang dipakai panel untuk menyatakan apakah jawaban baru benar-benar bersumber. Test Lab tidak berubah.

Alur di `FixAnswerPanel` setelah "Simpan & aktifkan" berhasil:

1. Panel langsung menjalankan uji ulang atas pertanyaan pelanggan yang sama, dengan konteks percakapan aslinya.
2. Panel menampilkan jawaban lama dan jawaban baru berdampingan, plus satu baris status: bersumber dari entri yang baru disimpan, atau belum.
3. Pertanyaannya: **"Jawaban ini sudah sesuai?"**
   - **Sudah** → `POST /api/inbox/gaps/[id]/resolve`, panel menutup putaran dan menampilkan ringkasan ("Aktif: <judul> v<N> · diuji ulang: sesuai").
   - **Belum** → kotak isian "Apa yang masih belum benar?" (minimal 10 karakter, sama dengan alasan revisi), lalu `KnowledgeEditor` terbuka lagi untuk entri yang sama dengan alasan sudah terisi kalimat itu. Menyimpan menghasilkan revisi berikutnya, dan putarannya berulang dari langkah 1.
4. Menutup panel di tengah putaran meninggalkan gap terbuka — sesuai keadaannya.

Panel menuliskan dua peringatan apa adanya: uji ulang berjalan di sandbox tanpa data booking, dan setiap putaran meninggalkan satu `BotDecisionRun` berstatus SIMULATED.

### F. Penutupan gap

- `POST /api/inbox/gaps/[id]/resolve` — `getSession` saja, mengisi `resolvedAt` bila masih kosong, mengembalikan `{ id, resolvedAt }`. Dipakai tombol "Sudah sesuai" di panel dan tombol "Tandai selesai" di halaman gap.
- `GET /api/inbox/gaps?limit=5` — `getSession` saja, mengembalikan `{ count, items }` hanya untuk gap yang belum selesai, terbaru dulu.
- `POST /api/inbox/decisions/[id]/fix` **tidak** menutup gap (lihat revisi keputusan di §2).
- Halaman `/settings/knowledge-gaps` mendapat kolom status + tombol "Tandai selesai"; penyaring alasan yang sudah ada tetap.

## 5. Pengujian

- **Status sinyal**: mode `faq` dengan `attributions` kosong ditandai; dengan kecocokan tidak; `clarify`/`handoff`/`booking_context` tidak pernah ditandai; keputusan tanpa `knowledge` tidak pernah ditandai.
- **Titik tulis**: baris gap membawa ketiga id; kegagalan penulisan tidak menggagalkan pengiriman; tidak ada baris ganda untuk satu giliran; event `knowledge.gap` dipancarkan.
- **Route**: `GET /api/inbox/gaps` (401 tanpa sesi, hanya yang belum selesai, hormati `limit`), `POST .../resolve` (401, 404, idempoten bila sudah selesai), `POST /api/inbox/retest` (401, meneruskan `conversationId` dan `useExistingHistory: true` ke `runSimulation`, 400 lewat Zod).
- **Simulator**: test yang membuktikan tidak ada `sendMessage` dan tidak ada `OutboundJob` tetap hijau; `knowledge` ikut di hasil.
- **Komponen**: lencana menghitung yang belum selesai; dropdown menampilkan lima; item tanpa `messageId` hanya membuka percakapan; `ThreadView` menggulung ke pesan yang diminta alih-alih ke bawah; `MessageBubble` membuka panel sendiri saat `autoOpenFix`; putaran uji ulang di `FixAnswerPanel` untuk kedua jawaban ("sudah" menutup gap, "belum" membuka editor dengan alasan terisi).
- **Gerbang umum**: `npm test`, `npx tsc --noEmit`, `npx eslint .`.

## 6. Risiko

- **Tingkat kemunculan belum diketahui.** Sinyal "tidak bersumber" belum pernah berjalan di produksi. Kalau ia menyala di hampir setiap jawaban, lonceng jadi kebisingan dan ambang pencocokan di `reply-attribution.ts` yang harus ditinjau — bukan loncengnya. Satu minggu setelah rilis, hitung: `SELECT reason, count(*) FROM "KnowledgeGapLog" WHERE "createdAt" > now() - interval '7 days' GROUP BY reason;`
- **Uji ulang memanggil model** beberapa detik per putaran, dan mengirim ulang teks pertanyaan pelanggan ke model — paparan yang sama dengan giliran aslinya, bukan paparan baru.
- **Sandbox tanpa data booking**: hasil uji ulang tidak mewakili pertanyaan yang jawabannya bergantung pada booking pelanggan. Untuk gap knowledge ini tidak jadi soal (jawaban FAQ tidak memakai data booking), dan panel menuliskannya.
- **Semua yang login bisa menjalankan uji ulang.** Ia kering dan tidak bisa mengirim, tetapi tetap memakai kapasitas model yang sama dengan bot yang sedang melayani pelanggan.
- **Putaran tak berujung** mungkin secara teknis: setiap "belum sesuai" menghasilkan revisi baru. Tidak dibatasi dengan sengaja — riwayat revisi yang bernomor adalah catatan yang jujur tentang berapa kali sebuah jawaban perlu diperbaiki.
