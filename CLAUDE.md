# CLAUDE.md — Konstitusi Pengembangan wa-inbox

Dokumen ini adalah **aturan kerja yang mengikat**, bukan saran. Setiap perubahan kode di repo
ini harus lolos seluruh aturan di bawah.

**Sumber kebenaran:** [`.claude/docs/wa-inbox-chatbot-control-center-guidebook.md`](.claude/docs/wa-inbox-chatbot-control-center-guidebook.md).
Jika instruksi percakapan bertentangan dengan guidebook, **guidebook menang**, kecuali user
secara eksplisit menyatakan ada perubahan spesifikasi.

---

## 1. Prinsip Utama

Urutan kerja produk ini tidak boleh dibalik:

1. **Expose** — tampilkan logika, knowledge, flow, trace, dan aturan bot yang **sudah ada**.
2. **Manage** — setelah terlihat, buat sebagian bisa dikelola dari UI.
3. **Extend** — setelah existing system bisa dicek dan dipercaya, baru tambah fitur baru.

Konsekuensi: jangan menulis flow/knowledge/automation baru sebelum yang existing terlihat dan
terverifikasi di UI.

---

## 2. Aturan Arsitektur

| Area | Aturan |
|---|---|
| Framework | Next.js 16 App Router. Page baru masuk `src/app/(authenticated)/`, API baru masuk `src/app/api/`. |
| Data | Prisma 7 + PostgreSQL. Akses DB **hanya** lewat `prisma` dari `@/lib/db`. Tidak ada SQL mentah kecuali benar-benar tidak ada jalan lain. |
| Dynamic route | Params Next 16 adalah Promise: `{ params }: { params: Promise<{ id: string }> }`, selalu `await params`. |
| Auth | Route admin memakai `requireAdmin(req)` dari `@/lib/auth/require-admin`. Route yang cukup butuh sesi memakai `getSession(req)`. Cookie parsing tidak boleh di-copy-paste ulang. |
| Body parsing | POST/PATCH memakai `parseJsonBody(req, zodSchema, pesanError)` dari `@/lib/parse-json`. Semua input tervalidasi Zod. |
| Fetch client | Client component memakai `fetchJson<T>()` dari `@/lib/fetch-json`, bukan `fetch().then(r => r.json())` telanjang. |
| Styling | Tailwind v4 + primitive di `src/components/ui/` (`Card`, `Badge`, `Button`, `Table`, `Input`, `Select`, `Textarea`, `Modal`). Jangan bikin primitive duplikat. |
| Bot logic | Logika keputusan bot tetap di `src/lib/bot/`. Layer Control Center (`src/lib/bot-control/`) hanya **membaca dan merepresentasikan**, tidak mengambil alih keputusan. |
| Registry | `existing-flow-registry.ts` dan `rule-registry.ts` adalah dokumentasi eksekutabel dari kode existing. Kalau kode di `src/lib/bot/` berubah, registry wajib diperbarui di commit yang sama. |

---

## 3. Aturan Bisnis (Channel Policy) — CRITICAL

Aturan ini tidak boleh dilanggar dalam bentuk apa pun:

1. **Official inbound only.** WhatsApp Official Cloud API dipakai sebagai webhook utama untuk
   *menerima* pesan dan event Meta.
2. **Unofficial outbound default.** Pesan agent dan bot dikirim lewat jalur
   Unofficial/coexistence secara default.
3. **Official send reserved.** Official send hanya untuk template official, campaign legal,
   utility/auth, atau fallback tertentu — bukan jalur kirim harian.
4. **No invented price.** Bot tidak boleh menyebut harga yang tidak ada di
   knowledge/catalog/booking data. Verifier harga tidak boleh dilemahkan.
5. **No invented URL.** Bot tidak boleh menyebut URL yang tidak ada di grounding.
6. **Booking context first.** Jika booking ditemukan, bot menjawab dari booking data sebelum
   katalog umum.
7. **Handoff on human request.** Permintaan bicara dengan manusia / komplain / frustrasi →
   handoff, dan handoff harus benar-benar mematikan `botEnabled` untuk conversation itu.
8. **Capability check sebelum kirim.** Fitur official-only (template, buttons, list, carousel)
   tidak boleh dikirim lewat Unofficial. Kalau tidak didukung, fallback ke teks.

Nomor testing yang diizinkan: **6282143403501**. Dilarang mengirim pesan test ke nomor
customer real dalam kondisi apa pun.

---

## 4. Enam Fase Pengerjaan (WAJIB URUT)

Dilarang mengerjakan fase N+1 sebelum Definition of Done fase N terpenuhi.

### Phase 1 — Read-only visibility
Menu `Bot Control`; `src/lib/bot-control/existing-flow-registry.ts` (28 node wajib);
`src/lib/bot-control/rule-registry.ts` (10 rule awal); API `/api/bot-control/flows`,
`/api/bot-control/flows/[key]`, `/api/bot-control/rules`; UI Flow Map + Rules Registry; tests.
**DoD:** flow & rules existing terlihat di UI; **tidak ada perubahan behavior send/bot**;
**tidak ada migration**.

### Phase 2 — Knowledge visibility
Model `KnowledgeSource` + `KnowledgeChunk` + migration; `knowledge-indexer.ts`; API knowledge
sources/chunks; UI Knowledge Explorer; tombol sync; tests.
**DoD:** semua catalog JSON terlihat & tercari di UI, `sourcePath` terlihat, perilaku bot tidak
berubah (index bukan sumber runtime).

### Phase 3 — Decision trace & logs
Model `BotDecisionRun`; `decision-recorder.ts`; integrasi ke `runBotForConversation`; API
decisions; UI Decision Logs; upgrade `BotTracePopover`; tests.
**DoD:** setiap bot run tercatat, `Message.botTrace` tetap ditulis untuk backward
compatibility, agent bisa lihat alasan bot dari inbox.

### Phase 4 — Test Lab
`simulator.ts`; API `POST /api/bot-control/simulate`; UI Test Lab; tests.
**DoD:** simulasi jalan **tanpa** `sendMessage` dan **tanpa** OutboundJob.

### Phase 5 — Documentation export
`documentation-exporter.ts`; API `GET /api/bot-control/export-docs`; UI preview + download +
copy; tests.
**DoD:** admin bisa export Markdown berisi flow, rules, knowledge, settings, gaps, tanpa secret.

### Phase 6 — Channel policy & outbound queue
`channel-capabilities.ts`; model `OutboundJob` + `ContactConsent`; `src/lib/outbound/queue.ts`,
`worker.ts`, `retry-policy.ts`, `safety-guard.ts`; Unofficial send lewat queue; UI failed/retry;
tests.
**DoD:** Unofficial send tidak lagi fire-and-forget, gagal kirim bisa retry, channel policy
terlihat di Bot Control.

Retry policy resmi: attempt 1 immediate → 2 setelah 30s → 3 setelah 2m → 4 setelah 10m → FAILED.

---

## 5. Larangan

1. **Dilarang `any`.** Pakai `unknown` + narrowing, atau tipe eksplisit. `as any` tidak
   diterima dalam review.
2. **Dilarang `console.log` di jalur production.** `console.warn` / `console.error` untuk
   kondisi yang benar-benar perlu diagnosa saja (ikuti pola `flushBurst` / `recordKnowledgeGap`).
3. **Dilarang membuat drag-and-drop flow builder sekarang.** Flow Map fase ini adalah list/step
   view read-only.
4. **Dilarang omnichannel selain WhatsApp** di fase ini.
5. **Dilarang mengganti total orchestrator bot.** Perubahan di `src/lib/bot/orchestrator.ts`
   hanya untuk merekam trace, bukan mengubah keputusan.
6. **Dilarang broadcast massal** tanpa safety guard + consent check.
7. **Dilarang menampilkan secret** (token, API key, app secret, credential) di UI, API response,
   trace, atau dokumen export.
8. **Dilarang migration di Phase 1.** Phase 1 murni membaca dari kode existing.
9. **Dilarang menghapus** official send/template yang sudah ada.
10. **Dilarang menulis test yang memanggil provider WhatsApp sungguhan.** Semua I/O eksternal
    di-mock.

---

## 6. Standar Kode

- **Error response API selalu** `{ error: string }` dengan status yang tepat
  (400 validasi, 401 tanpa sesi, 403 role kurang, 404 tidak ditemukan, 409 konflik).
- **Response sukses mengikuti kontrak** di guidebook section 20 — jangan mengarang bentuk lain.
- **Komentar menjelaskan *kenapa*, bukan *apa*.** Ikuti gaya file existing: jelaskan bug yang
  pernah terjadi, alternatif yang ditolak, dan alasannya.
- **Bahasa UI: Indonesia.** Nama variabel/fungsi: Inggris.
- **Role gating:** `AGENT` read-only untuk area berisiko; `ADMIN` untuk sync, export, simulate,
  dan edit setting.

## 7. Definition of Done

Sebuah task **belum selesai** sampai semuanya hijau:

```bash
npx tsc --noEmit     # nol error
npx eslint .         # nol error
npm test             # semua lulus, termasuk test baru untuk kode baru
```

Ditambah:

1. Ada test untuk setiap file baru di `src/lib/bot-control/` dan `src/lib/outbound/`.
2. Ada route test untuk setiap API route baru (shape response + gating role).
3. Ada component test untuk setiap komponen baru yang punya state/filter.
4. Migration Prisma dibuat bila skema berubah (dan **tidak** dibuat di Phase 1).
5. Tidak ada secret bocor di UI/API/docs.
6. Simulator tidak mengirim WhatsApp.
7. Unofficial tetap default outbound; Official tetap tersedia untuk capability.
8. Registry di `src/lib/bot-control/` sinkron dengan kode bot yang sebenarnya.

---

## 8. Definition of Success

Owner/operator bisa menjawab ini **tanpa membuka kode**: bot punya flow apa saja; menjawab dari
knowledge apa; kenapa menjawab begitu; kenapa handoff; kenapa diam; knowledge mana yang kurang;
pesan mana yang gagal terkirim; jalur pengiriman mana yang dipakai; fitur mana yang official-only;
apakah perubahan bot aman sebelum live.
