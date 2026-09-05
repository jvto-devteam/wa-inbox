# Guidebook Eksekusi: Wa-Inbox Chatbot Control Center

Tanggal dokumen: 2026-09-04

## 1. Ringkasan Untuk Tim Developer

Dokumen ini adalah panduan eksekusi untuk mengembangkan `wa-inbox` menjadi platform chatbot WhatsApp yang lebih terlihat, terkontrol, terdokumentasi, dan siap dipakai real.

Fokus utama fase ini bukan langsung membuat chatbot baru dari nol. Fokusnya adalah membuka dan mengelola semua kemampuan yang sebenarnya sudah ada di `wa-inbox`, tetapi masih tersembunyi di kode, JSON, dan trace database.

Prinsip utama:

1. Expose first: tampilkan logika, knowledge, flow, trace, dan aturan bot yang sudah ada.
2. Manage second: setelah terlihat, buat sebagian bisa dikelola dari UI.
3. Extend third: setelah existing system bisa dicek dan dipercaya, baru tambah flow, automation, campaign, dan fitur baru.

Konteks operasional:

1. WhatsApp Official hanya digunakan sebagai webhook utama untuk menerima pesan dan event Meta.
2. WhatsApp Unofficial atau coexistence adalah jalur pengiriman utama untuk agent dan bot.
3. WhatsApp Official tetap dipertahankan sebagai capability layer untuk fitur resmi seperti template, campaign legal, message template, interactive official, dan fallback tertentu.
4. Fokus produk saat ini adalah WhatsApp dulu. Usulan omnichannel disimpan untuk fase berikutnya.

Target hasil akhir:

1. Tim operator bisa melihat flow bot saat ini.
2. Tim operator bisa melihat knowledge base yang dipakai bot.
3. Tim operator bisa melihat alasan bot menjawab, handoff, diam, atau fallback.
4. Tim operator bisa mengetes pesan tanpa mengirim ke WhatsApp real.
5. Tim operator bisa melihat gap knowledge dan mengubahnya menjadi task perbaikan.
6. Tim developer punya struktur data/API/UI yang siap dikembangkan menjadi flow builder, campaign, dan automation.

## 2. Kondisi Sistem Saat Ini

Repo: `jvto-devteam/wa-inbox`

Stack:

1. Next.js 16 App Router.
2. React 19.
3. TypeScript.
4. Prisma 7.
5. PostgreSQL.
6. Tailwind CSS v4.
7. Vitest.
8. Ollama local untuk LLM.
9. WhatsApp Official Cloud API untuk webhook dan sebagian official send/template.
10. wa-coexist atau jalur unofficial untuk pengiriman.

Menu yang sudah ada:

1. Beranda.
2. Chat / Inbox.
3. Kontak.
4. Template Pesan.
5. Chatbot.
6. Pengaturan.

Kemampuan yang sudah ada tetapi belum sepenuhnya terlihat:

1. Bot decision logic di `src/lib/bot/orchestrator.ts`.
2. Knowledge/catalog di folder `catalog/*.json`.
3. Bot trace tersimpan di `Message.botTrace`.
4. Knowledge gap tersimpan di `KnowledgeGapLog`.
5. WhatsApp webhook normalizer di `src/lib/inbound.ts`.
6. Official/unofficial send router di `src/lib/send.ts` dan `src/lib/channel-router.ts`.
7. Template official/quick reply/carousel/LTO/coupon/auth.
8. Booking context.
9. Route/package matching.
10. Reply verifier untuk harga dan URL.
11. Handoff logic.
12. Indonesian-number bot filter.
13. Working hours dan off-hours auto reply.
14. Test room untuk simulasi bot.

Masalah utama:

1. Operator tidak dapat melihat flow bot secara menyeluruh.
2. Operator tidak dapat melihat semua knowledge yang dipakai bot dalam UI.
3. Operator tidak mudah mengecek kenapa bot memberi jawaban tertentu.
4. Operator tidak mudah melakukan crosscheck sebelum knowledge atau logika dipakai live.
5. Bot logic masih sangat bergantung pada kode dan file JSON.
6. Dokumentasi hidup dari sistem belum tersedia.
7. WhatsApp Unofficial sebagai jalur utama belum punya queue/retry/safety guard yang cukup kuat.

## 3. Scope Fase Ini

Scope wajib:

1. Membuat Bot Control Center atau Chatbot Studio.
2. Menampilkan existing bot flow secara read-only.
3. Menampilkan knowledge/catalog yang sudah ada.
4. Menampilkan decision trace dari jawaban bot.
5. Membuat simulator untuk mengetes pesan tanpa mengirim WhatsApp.
6. Membuat dokumentasi otomatis dari flow, rules, knowledge, dan settings.
7. Membuat WhatsApp channel policy yang jelas: Official inbound, Unofficial outbound default.
8. Membuat dasar outbound queue untuk Unofficial.
9. Membuat daftar gap fitur berikutnya untuk flow builder, automation, campaign, dan omnichannel.

Non-scope fase ini:

1. Tidak membuat drag-and-drop flow builder penuh.
2. Tidak membuat omnichannel selain WhatsApp.
3. Tidak mengganti total orchestrator bot.
4. Tidak mengubah model bisnis booking yang sudah ada.
5. Tidak menghapus official send/template yang sudah ada.
6. Tidak melakukan broadcast massal otomatis tanpa safety guard.

## 4. Target Produk

Tambahkan menu baru:

Nama menu: `Bot Control`

Alternatif nama:

1. Chatbot Studio.
2. Bot Control Center.
3. Bot Console.

Rekomendasi: gunakan `Bot Control`.

Alasan:

1. Lebih jelas untuk tim operasional.
2. Tidak terdengar seperti fitur baru saja.
3. Cocok untuk fungsi audit, management, testing, dan dokumentasi.

Struktur menu `Bot Control`:

1. Overview.
2. Flow Map.
3. Knowledge Explorer.
4. Decision Logs.
5. Test Lab.
6. Rules Registry.
7. Documentation.
8. Settings.

## 5. Arsitektur Baru Yang Diinginkan

Alur utama WhatsApp:

```text
Meta Official Webhook
  -> Webhook Verification
  -> Message Normalizer
  -> Conversation Store
  -> Bot Eligibility Check
  -> Bot Decision Engine
  -> Decision Trace
  -> Outbound Policy Resolver
  -> Unofficial Outbound Queue
  -> wa-coexist Provider
  -> Realtime Inbox Update
```

Alur official capability:

```text
Bot/Agent/Campaign
  -> Capability Check
  -> Official-only Feature?
  -> Meta Template / Official Message API
  -> Status Webhook
  -> Message Timeline
```

Alur test/simulasi:

```text
Test Lab Input
  -> Simulated Conversation Context
  -> Existing Bot Decision Engine
  -> Trace Capture
  -> Draft Reply
  -> Verification Result
  -> No WhatsApp Send
```

## 6. Data Model Yang Perlu Ditambah

Semua perubahan skema dilakukan di `prisma/schema.prisma`.

### 6.1 BotFlowDefinition

Tujuan:

Menyimpan representasi read-only atau semi-managed dari flow bot yang sudah ada.

Untuk fase awal, data ini boleh dihasilkan dari static registry di kode, bukan full editable builder.

Model:

```prisma
model BotFlowDefinition {
  id          String   @id @default(cuid())
  key         String   @unique
  name        String
  description String?
  version     Int      @default(1)
  status      String   @default("ACTIVE") // ACTIVE, DRAFT, ARCHIVED
  source      String   @default("CODE")   // CODE, UI, IMPORT
  nodes       Json
  edges       Json
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}
```

Acceptance:

1. Minimal ada 1 flow definition untuk existing bot.
2. Flow definition dapat dibaca API.
3. UI dapat menampilkan daftar step bot secara berurutan.

### 6.2 BotRuleDefinition

Tujuan:

Mendaftarkan aturan bot yang sekarang tersembunyi di kode.

Contoh rule:

1. Bot tidak membalas nomor Indonesia jika setting aktif.
2. Bot handoff jika user meminta human/agent.
3. Bot tanya klarifikasi jika destinasi tidak jelas.
4. Bot tidak boleh mengarang harga.
5. Bot tidak boleh mengarang URL.
6. Bot menggunakan booking context jika booking ditemukan.

Model:

```prisma
model BotRuleDefinition {
  id          String   @id @default(cuid())
  key         String   @unique
  name        String
  category    String
  description String
  sourceFile  String?
  sourceRef   String?
  severity    String   @default("NORMAL") // LOW, NORMAL, HIGH, CRITICAL
  editable    Boolean  @default(false)
  enabled     Boolean  @default(true)
  config      Json?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}
```

Acceptance:

1. Rules Registry menampilkan semua rule penting.
2. Rule yang belum aman diedit harus `editable=false`.
3. UI tidak menyediakan toggle untuk rule non-editable.

### 6.3 KnowledgeSource

Tujuan:

Membungkus sumber knowledge yang saat ini tersebar di `catalog/*.json`.

Model:

```prisma
model KnowledgeSource {
  id          String   @id @default(cuid())
  key         String   @unique
  title       String
  type        String   // CATALOG_JSON, FAQ, URL, PDF, DOC, MANUAL
  sourcePath  String?
  status      String   @default("PUBLISHED") // DRAFT, REVIEW, PUBLISHED, ARCHIVED
  summary     String?
  metadata    Json?
  lastSyncedAt DateTime?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  chunks       KnowledgeChunk[]
}
```

### 6.4 KnowledgeChunk

Tujuan:

Membuat knowledge bisa dicari, ditampilkan, dan dikutip oleh trace.

Model:

```prisma
model KnowledgeChunk {
  id              String          @id @default(cuid())
  knowledgeSourceId String
  knowledgeSource   KnowledgeSource @relation(fields: [knowledgeSourceId], references: [id], onDelete: Cascade)
  topic           String?
  title           String?
  body            String
  facts           Json?
  links           Json?
  prices          Json?
  tags            Json?
  hash            String
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@index([topic])
  @@index([hash])
}
```

Acceptance:

1. Existing catalog JSON dapat di-index menjadi KnowledgeSource dan KnowledgeChunk.
2. Knowledge Explorer bisa menampilkan sumber file, topik, fakta, link, harga, dan tags.
3. Tidak ada perubahan perilaku bot pada fase indexing awal.

### 6.5 BotDecisionRun

Tujuan:

Membuat hasil keputusan bot dapat diaudit sebagai entitas sendiri, bukan hanya JSON di message.

Model:

```prisma
model BotDecisionRun {
  id             String   @id @default(cuid())
  conversationId String
  messageId      String?
  mode           String
  inboundText    String
  replyText      String?
  status         String   // REPLIED, CLARIFIED, HANDOFF, FAILED, SKIPPED
  flowKey        String?
  flowVersion    Int?
  startedAt      DateTime @default(now())
  finishedAt     DateTime?
  latencyMs      Int?
  trace          Json
  knowledgeRefs  Json?
  verification   Json?
  error          String?

  @@index([conversationId])
  @@index([startedAt])
  @@index([status])
}
```

Acceptance:

1. Setiap bot run baru tersimpan ke `BotDecisionRun`.
2. Bubble bot tetap menyimpan `Message.botTrace` untuk backward compatibility.
3. Decision Logs membaca dari `BotDecisionRun`.

### 6.6 OutboundJob

Tujuan:

Karena Unofficial adalah jalur kirim utama, pengiriman tidak boleh bergantung pada direct send satu kali.

Model:

```prisma
model OutboundJob {
  id             String   @id @default(cuid())
  conversationId String
  messageId      String?
  channel        MessageChannel
  provider       String   // COEXIST, META
  payload        Json
  status         String   @default("QUEUED") // QUEUED, SENDING, SENT, FAILED, RETRYING, CANCELLED
  attempts       Int      @default(0)
  maxAttempts    Int      @default(3)
  nextAttemptAt  DateTime?
  lastError      String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@index([status, nextAttemptAt])
  @@index([conversationId])
}
```

Acceptance:

1. Agent/bot send ke Unofficial membuat OutboundJob.
2. Worker memproses job.
3. Jika gagal, job retry.
4. Jika tetap gagal, UI menampilkan status gagal dan tombol retry.

### 6.7 ContactConsent

Tujuan:

Mendukung opt-in/opt-out, anti-spam, dan campaign aman.

Model:

```prisma
model ContactConsent {
  id        String   @id @default(cuid())
  contactId String  @unique
  optIn     Boolean @default(true)
  optOut    Boolean @default(false)
  source    String?
  note      String?
  updatedBy String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

Acceptance:

1. Contact detail menampilkan opt-in/opt-out.
2. Outbound policy mencegah campaign ke opt-out contact.
3. Manual 1:1 reply tetap bisa diberi warning, bukan selalu diblokir.

## 7. File Baru Yang Perlu Dibuat

### 7.1 Bot registry

Buat folder:

```text
src/lib/bot-control/
```

File:

```text
src/lib/bot-control/existing-flow-registry.ts
src/lib/bot-control/rule-registry.ts
src/lib/bot-control/knowledge-indexer.ts
src/lib/bot-control/decision-recorder.ts
src/lib/bot-control/simulator.ts
src/lib/bot-control/documentation-exporter.ts
src/lib/bot-control/channel-capabilities.ts
```

### 7.2 API routes

Buat routes:

```text
src/app/api/bot-control/overview/route.ts
src/app/api/bot-control/flows/route.ts
src/app/api/bot-control/flows/[key]/route.ts
src/app/api/bot-control/rules/route.ts
src/app/api/bot-control/knowledge/sources/route.ts
src/app/api/bot-control/knowledge/chunks/route.ts
src/app/api/bot-control/decisions/route.ts
src/app/api/bot-control/decisions/[id]/route.ts
src/app/api/bot-control/simulate/route.ts
src/app/api/bot-control/export-docs/route.ts
src/app/api/outbound-jobs/retry/route.ts
```

### 7.3 UI pages

Buat pages:

```text
src/app/(authenticated)/bot-control/page.tsx
src/app/(authenticated)/bot-control/flows/page.tsx
src/app/(authenticated)/bot-control/knowledge/page.tsx
src/app/(authenticated)/bot-control/decisions/page.tsx
src/app/(authenticated)/bot-control/test-lab/page.tsx
src/app/(authenticated)/bot-control/rules/page.tsx
src/app/(authenticated)/bot-control/docs/page.tsx
src/app/(authenticated)/bot-control/settings/page.tsx
```

### 7.4 UI components

Buat components:

```text
src/components/bot-control/FlowStepList.tsx
src/components/bot-control/FlowStepCard.tsx
src/components/bot-control/KnowledgeSourceTable.tsx
src/components/bot-control/KnowledgeChunkPanel.tsx
src/components/bot-control/DecisionTracePanel.tsx
src/components/bot-control/TestLab.tsx
src/components/bot-control/RuleRegistryTable.tsx
src/components/bot-control/BotRunTimeline.tsx
src/components/bot-control/ChannelCapabilityTable.tsx
src/components/bot-control/DocumentationPreview.tsx
```

## 8. Existing Flow Registry

File: `src/lib/bot-control/existing-flow-registry.ts`

Isi awal harus merepresentasikan flow existing dari `orchestrator.ts` dan `inbound.ts`.

Contoh struktur:

```ts
export type ExistingFlowNode = {
  id: string
  order: number
  name: string
  type: 'webhook' | 'guard' | 'classifier' | 'lookup' | 'knowledge' | 'llm' | 'verification' | 'send' | 'handoff'
  description: string
  sourceFile: string
  sourceRef?: string
  possibleOutputs: string[]
}

export type ExistingFlowDefinition = {
  key: string
  name: string
  version: number
  description: string
  nodes: ExistingFlowNode[]
  edges: Array<{ from: string; to: string; condition?: string }>
}
```

Flow wajib:

```text
whatsapp-existing-bot-v1
```

Node wajib:

1. `meta-webhook-received`
2. `signature-verified`
3. `payload-normalized`
4. `conversation-upserted`
5. `default-bot-policy-checked`
6. `burst-debounce`
7. `fresh-bot-enabled-check`
8. `rate-limit-check`
9. `decide-and-respond`
10. `escalation-keyword-check`
11. `escalation-llm-check`
12. `booking-lookup`
13. `booking-context-reply`
14. `deployment-gate`
15. `sales-need-classification`
16. `destination-match`
17. `route-integrity-gate`
18. `package-pool-narrowing`
19. `topic-classification`
20. `trip-preference-check`
21. `knowledge-resolution`
22. `llm-composition`
23. `reply-verification`
24. `outbound-policy-resolution`
25. `unofficial-send`
26. `official-template-send`
27. `handoff-alert`
28. `knowledge-gap-log`

Acceptance:

1. Flow Map page menampilkan node sesuai urutan.
2. Setiap node punya source file dan deskripsi.
3. Setiap node punya possible outputs.
4. Tidak perlu drag-and-drop.

## 9. Rules Registry

File: `src/lib/bot-control/rule-registry.ts`

Daftar rule awal:

### Rule 1: Official inbound only

```text
Key: channel.official_inbound_only
Category: Channel Policy
Severity: CRITICAL
Editable: false
Rule: WhatsApp Official digunakan sebagai webhook utama untuk menerima pesan dan event Meta.
```

### Rule 2: Unofficial outbound default

```text
Key: channel.unofficial_outbound_default
Category: Channel Policy
Severity: CRITICAL
Editable: true
Rule: Pesan agent dan bot dikirim melalui Unofficial/coexistence secara default.
```

### Rule 3: Official send reserved

```text
Key: channel.official_reserved_for_capabilities
Category: Channel Policy
Severity: HIGH
Editable: true
Rule: Official send hanya dipakai untuk template official, campaign legal, utility/auth, atau fallback tertentu.
```

### Rule 4: No invented price

```text
Key: bot.no_invented_price
Category: Safety
Severity: CRITICAL
Editable: false
Rule: Bot tidak boleh menyebut harga yang tidak ada di knowledge/catalog/booking data.
```

### Rule 5: No invented URL

```text
Key: bot.no_invented_url
Category: Safety
Severity: CRITICAL
Editable: false
Rule: Bot tidak boleh menyebut URL yang tidak ada di grounding.
```

### Rule 6: Human request handoff

```text
Key: bot.handoff_on_human_request
Category: Handoff
Severity: HIGH
Editable: true
Rule: Jika customer meminta bicara dengan manusia/agent atau menunjukkan komplain/frustrasi, bot melakukan handoff.
```

### Rule 7: Booking context first

```text
Key: bot.booking_context_first
Category: Decision
Severity: HIGH
Editable: false
Rule: Jika booking ditemukan, bot menjawab berdasarkan booking data sebelum memakai katalog umum.
```

### Rule 8: Indonesia number filter

```text
Key: bot.skip_indonesian_numbers
Category: Market Policy
Severity: NORMAL
Editable: true
Rule: Jika setting aktif, bot tidak membalas otomatis nomor +62.
```

### Rule 9: Burst debounce

```text
Key: bot.burst_debounce
Category: Delivery Quality
Severity: NORMAL
Editable: false
Rule: Pesan customer yang datang beruntun digabung sebelum bot menjawab.
```

### Rule 10: Rate limit

```text
Key: bot.rate_limit
Category: Abuse Protection
Severity: HIGH
Editable: false
Rule: Bot membatasi jumlah auto-reply per conversation dalam window tertentu.
```

Acceptance:

1. Rules page menampilkan semua rule.
2. Rule editable boleh punya toggle atau config.
3. Rule non-editable hanya tampil read-only.
4. Setiap rule punya keterangan source.

## 10. Knowledge Explorer

Tujuan:

Membuka isi knowledge yang sekarang tersembunyi di `catalog/*.json`.

### 10.1 Indexer

File: `src/lib/bot-control/knowledge-indexer.ts`

Fungsi wajib:

```ts
export async function indexCatalogKnowledge(): Promise<{
  sourcesIndexed: number
  chunksIndexed: number
}>
```

Input:

1. Semua file JSON di folder `catalog`.
2. File nested seperti `catalog/itinerary-intelligence/*.json`.

Output:

1. `KnowledgeSource`.
2. `KnowledgeChunk`.

Aturan:

1. Jangan ubah perilaku bot existing.
2. Jangan overwrite source manual.
3. Gunakan hash untuk mencegah duplikasi chunk.
4. Simpan `sourcePath` untuk crosscheck.
5. Simpan metadata file seperti ukuran file, last modified, dan top-level keys.

### 10.2 UI Knowledge Explorer

Page: `src/app/(authenticated)/bot-control/knowledge/page.tsx`

Tampilan:

1. Search input.
2. Filter source type.
3. Filter status.
4. Filter topic/tag.
5. Table knowledge source.
6. Panel detail chunk.

Kolom source:

1. Title.
2. Type.
3. Source path.
4. Status.
5. Jumlah chunk.
6. Last synced.
7. Action: view chunks.

Kolom chunk:

1. Topic.
2. Title.
3. Body preview.
4. Links count.
5. Prices count.
6. Tags.
7. Hash.

Acceptance:

1. Operator bisa melihat isi katalog tanpa buka JSON.
2. Operator bisa mencari knowledge berdasarkan keyword.
3. Operator bisa tahu knowledge berasal dari file mana.
4. Operator bisa lihat harga/link yang tersedia untuk bot.

## 11. Decision Logs dan Trace Viewer

Tujuan:

Membuat setiap keputusan bot dapat dicek ulang.

### 11.1 Recorder

File: `src/lib/bot-control/decision-recorder.ts`

Fungsi:

```ts
export async function recordBotDecisionRun(params: {
  conversationId: string
  messageId?: string
  inboundText: string
  decision: unknown
  startedAt: Date
  finishedAt: Date
  error?: string
}): Promise<void>
```

Integrasi:

1. Panggil dari `runBotForConversation`.
2. Simpan mode, reply, status, trace, knowledge refs, verification.
3. Jika terjadi error, tetap record dengan `status=FAILED`.

Status mapping:

```text
decision.mode = faq -> REPLIED
decision.mode = booking_context -> REPLIED
decision.mode = clarify -> CLARIFIED
decision.mode = handoff -> HANDOFF
rate limit skipped -> SKIPPED
exception -> FAILED
```

### 11.2 Decision Logs Page

Page: `src/app/(authenticated)/bot-control/decisions/page.tsx`

Filter:

1. Date range.
2. Status.
3. Mode.
4. Conversation.
5. Has knowledge gap.
6. Has verification failure.

Table:

1. Time.
2. Contact.
3. Inbound preview.
4. Mode.
5. Status.
6. Latency.
7. Knowledge refs count.
8. Verification result.
9. Action: view detail.

Detail panel:

1. Inbound message.
2. Reply draft.
3. Flow steps passed.
4. Classifier results.
5. Booking lookup result.
6. Destination/package match.
7. Knowledge used.
8. Verification result.
9. Handoff/fallback reason.
10. Error if any.

Acceptance:

1. Operator bisa membuka decision log dari menu.
2. Operator bisa membuka trace dari bubble bot di inbox.
3. Trace tidak hanya JSON mentah, tetapi dirender menjadi bagian yang bisa dibaca.

## 12. Bot Trace Di Inbox

Modifikasi:

1. `src/components/inbox/MessageBubble.tsx`
2. `src/components/inbox/BotTracePopover.tsx`

Requirement:

1. Untuk pesan `sentBy=BOT`, tampilkan tombol kecil `Lihat alasan bot`.
2. Jika `botTrace` ada, tampilkan trace panel.
3. Jika `BotDecisionRun` ada, tampilkan link ke decision detail.
4. Jika trace kosong, tampilkan pesan: `Trace tidak tersedia untuk pesan ini`.

Trace sections:

1. Keputusan akhir.
2. Flow step.
3. Knowledge yang dipakai.
4. Booking/context data.
5. Verifikasi harga/URL.
6. Alasan handoff/fallback.
7. Raw trace collapsible untuk developer.

Acceptance:

1. Agent tidak perlu membuka database untuk tahu alasan bot.
2. Trace tetap aman: jangan tampilkan token/API key.
3. Booking data sensitif hanya tampil ringkas.

## 13. Test Lab

Tujuan:

Menguji pesan customer tanpa mengirim ke WhatsApp.

Page:

```text
src/app/(authenticated)/bot-control/test-lab/page.tsx
```

API:

```text
POST /api/bot-control/simulate
```

Request:

```json
{
  "conversationId": "optional-existing-conversation-id",
  "contactPhone": "optional-phone",
  "contactName": "optional-name",
  "message": "berapa harga ijen 3d2n dari bali?",
  "useExistingHistory": true,
  "dryRun": true
}
```

Response:

```json
{
  "mode": "faq",
  "reply": "...",
  "status": "WOULD_REPLY",
  "flowSteps": [],
  "knowledgeRefs": [],
  "verification": {},
  "warnings": []
}
```

Aturan:

1. Jangan panggil `sendMessage`.
2. Jangan membuat outbound job.
3. Boleh memakai existing conversation context jika dipilih.
4. Boleh membuat temporary simulated context in-memory.
5. Simulasi harus mencatat hasil ke `BotDecisionRun` dengan status `SKIPPED` atau `SIMULATED`, jika enum status dipilih string bebas.

UI:

1. Textarea pesan.
2. Pilihan context:
   - Tanpa history.
   - Pakai conversation existing.
   - Pakai test room.
3. Tombol `Jalankan Simulasi`.
4. Panel hasil:
   - Draft reply.
   - Flow steps.
   - Knowledge used.
   - Verification.
   - Warnings.
   - Would send via channel.

Acceptance:

1. Operator bisa mengetes pesan tanpa risiko mengirim WA.
2. Hasil simulator sama dengan decision engine existing sejauh mungkin.
3. Simulator menampilkan kenapa bot memilih jawaban tersebut.

## 14. Documentation Export

Tujuan:

Membuat dokumentasi hidup dari sistem bot.

API:

```text
GET /api/bot-control/export-docs
```

Output:

Markdown.

Isi dokumen:

1. Bot overview.
2. Channel policy.
3. Existing flow map.
4. Rules registry.
5. Knowledge sources.
6. Template summary.
7. Bot settings.
8. Handoff rules.
9. Verification rules.
10. Known gaps.
11. Last generated timestamp.

File generator:

```text
src/lib/bot-control/documentation-exporter.ts
```

Acceptance:

1. Operator bisa download dokumentasi.
2. Dokumentasi bisa diberikan ke owner/admin non-developer.
3. Dokumentasi tidak menampilkan secret.

## 15. Channel Capability Matrix

Tujuan:

Membuat sistem tahu fitur mana yang bisa dikirim via Unofficial dan mana yang official-only.

File:

```text
src/lib/bot-control/channel-capabilities.ts
```

Contoh:

```ts
export type ChannelCapability =
  | 'receive_webhook'
  | 'send_text'
  | 'send_media'
  | 'send_document'
  | 'send_audio'
  | 'send_template'
  | 'send_carousel'
  | 'send_buttons'
  | 'send_list'
  | 'delivery_status'
  | 'read_receipt'
  | 'campaign'

export const CHANNEL_CAPABILITIES = {
  OFFICIAL: {
    receive_webhook: true,
    send_text: true,
    send_media: true,
    send_document: true,
    send_audio: true,
    send_template: true,
    send_carousel: true,
    send_buttons: true,
    send_list: true,
    delivery_status: true,
    read_receipt: true,
    campaign: true,
  },
  UNOFFICIAL: {
    receive_webhook: false,
    send_text: true,
    send_media: true,
    send_document: true,
    send_audio: true,
    send_template: false,
    send_carousel: false,
    send_buttons: false,
    send_list: false,
    delivery_status: false,
    read_receipt: false,
    campaign: 'LIMITED',
  },
} as const
```

Important:

1. Sesuaikan value final dengan kemampuan provider Unofficial yang dipakai.
2. Jika provider mendukung button/list/carousel, ubah matrix.
3. Jika tidak mendukung, UI harus fallback ke teks.

Acceptance:

1. Bot dan template sender mengecek capability sebelum kirim.
2. UI menampilkan badge `Official only` untuk fitur yang tidak bisa via Unofficial.
3. Default outbound tetap Unofficial.

## 16. Outbound Queue Untuk Unofficial

Ini adalah fondasi wajib untuk penggunaan real.

### 16.1 Perubahan Send Flow

Saat ini `sendMessage` langsung mengirim ke provider.

Target:

1. `sendMessage` tetap membuat `Message`.
2. Untuk channel Unofficial, buat `OutboundJob`.
3. Worker memproses job.
4. Status message mengikuti hasil job.

File baru:

```text
src/lib/outbound/queue.ts
src/lib/outbound/worker.ts
src/lib/outbound/retry-policy.ts
```

Fungsi:

```ts
export async function enqueueOutboundJob(params: {
  conversationId: string
  messageId: string
  channel: 'OFFICIAL' | 'UNOFFICIAL'
  provider: 'COEXIST' | 'META'
  payload: unknown
}): Promise<void>
```

```ts
export async function processDueOutboundJobs(limit?: number): Promise<{
  processed: number
  sent: number
  failed: number
  retrying: number
}>
```

Retry policy:

```text
Attempt 1: immediate
Attempt 2: after 30 seconds
Attempt 3: after 2 minutes
Attempt 4: after 10 minutes
Then FAILED
```

### 16.2 UI retry

Di MessageBubble:

1. Jika deliveryStatus `FAILED`, tampilkan tombol `Retry`.
2. Retry membuat job baru atau reset job failed.
3. Jangan membuat duplicate message kecuali user memilih `Kirim sebagai pesan baru`.

Acceptance:

1. Pengiriman Unofficial tidak hilang jika provider down sesaat.
2. Pesan gagal terlihat jelas di inbox.
3. Operator bisa retry.

## 17. WhatsApp Safety Guard

Tambahkan guard sebelum outbound job diproses.

File:

```text
src/lib/outbound/safety-guard.ts
```

Rules awal:

1. Jangan kirim ke contact opt-out untuk campaign.
2. Batasi auto-reply bot per conversation.
3. Batasi campaign batch per menit.
4. Jangan kirim pesan identik berulang dalam window pendek.
5. Jika provider failure rate naik, pause batch/campaign.
6. Jika conversation sedang diambil alih agent, bot tidak boleh mengirim.

Fungsi:

```ts
export async function checkOutboundSafety(params: {
  conversationId: string
  contactId: string
  messageText?: string
  sentBy: 'BOT' | 'AGENT'
  purpose: 'ONE_TO_ONE' | 'BOT_REPLY' | 'CAMPAIGN'
}): Promise<{
  allowed: boolean
  warnings: string[]
  blockingReason?: string
}>
```

Acceptance:

1. Bot reply tetap aman.
2. Manual agent send tetap fleksibel.
3. Campaign lebih ketat.
4. Semua block/warning tercatat.

## 18. UI Detail Per Halaman

### 18.1 Bot Control Overview

Page:

```text
src/app/(authenticated)/bot-control/page.tsx
```

Cards:

1. Bot mode: On semua chat / Off manual.
2. Outbound default: Unofficial.
3. Official webhook: active/inactive.
4. Unofficial provider: configured/unconfigured.
5. Knowledge sources count.
6. Bot runs today.
7. Handoff today.
8. Knowledge gaps today.
9. Failed outbound jobs.

Widgets:

1. Latest 10 bot decisions.
2. Top unanswered topics.
3. Channel capability summary.
4. Recent failed sends.

### 18.2 Flow Map

Page:

```text
src/app/(authenticated)/bot-control/flows/page.tsx
```

Layout:

1. Left: flow list.
2. Center: step list atau simple node map.
3. Right: selected step detail.

Step detail:

1. Name.
2. Type.
3. Description.
4. Source file.
5. Possible outputs.
6. Related rules.
7. Related tests if known.

Fase awal tidak perlu canvas drag-and-drop.

### 18.3 Rules Registry

Page:

```text
src/app/(authenticated)/bot-control/rules/page.tsx
```

Table:

1. Rule name.
2. Category.
3. Severity.
4. Enabled.
5. Editable.
6. Source.
7. Description.

### 18.4 Knowledge Explorer

Sudah dijelaskan di section 10.

### 18.5 Decision Logs

Sudah dijelaskan di section 11.

### 18.6 Test Lab

Sudah dijelaskan di section 13.

### 18.7 Documentation

Page:

```text
src/app/(authenticated)/bot-control/docs/page.tsx
```

Features:

1. Preview generated documentation.
2. Button download Markdown.
3. Button copy.
4. Last generated timestamp.

## 19. Modifikasi Navigasi

File:

```text
src/components/AppNav.tsx
```

Tambahkan menu:

```ts
{ href: '/bot-control', label: 'Bot Control' }
```

Jika ingin menjaga nav tetap ringkas:

1. Gabungkan menu `Chatbot` ke dalam `Bot Control`.
2. Atau jadikan `Chatbot` sebagai subpage `Bot Control > Settings`.

Rekomendasi:

1. Tetap pertahankan `Chatbot` dulu.
2. Tambahkan `Bot Control`.
3. Setelah semua stabil, pindahkan setting chatbot ke `Bot Control > Settings`.

Acceptance:

1. Menu baru muncul untuk user authenticated.
2. Role AGENT bisa read-only.
3. Role ADMIN bisa menjalankan sync, export, simulate, dan edit setting.

## 20. API Contract Detail

### 20.1 GET /api/bot-control/overview

Response:

```json
{
  "botMode": {
    "autoReplyAll": true,
    "skipIndonesianNumbers": false,
    "ollamaModel": "gemma4:31b-cloud"
  },
  "channels": {
    "officialWebhookConfigured": true,
    "officialTokenValid": true,
    "unofficialConfigured": true,
    "defaultOutbound": "UNOFFICIAL"
  },
  "knowledge": {
    "sources": 12,
    "chunks": 340,
    "lastSyncedAt": "2026-09-04T00:00:00.000Z"
  },
  "today": {
    "botRuns": 58,
    "handoffs": 7,
    "knowledgeGaps": 4,
    "failedOutboundJobs": 2"
  }
}
```

Note:

Hapus tanda kutip ekstra pada implementasi final jika menyalin contoh JSON. Field `failedOutboundJobs` harus number.

### 20.2 GET /api/bot-control/flows

Response:

```json
{
  "flows": [
    {
      "key": "whatsapp-existing-bot-v1",
      "name": "WhatsApp Existing Bot",
      "version": 1,
      "nodesCount": 28,
      "status": "ACTIVE"
    }
  ]
}
```

### 20.3 GET /api/bot-control/flows/[key]

Response:

```json
{
  "key": "whatsapp-existing-bot-v1",
  "name": "WhatsApp Existing Bot",
  "version": 1,
  "nodes": [],
  "edges": []
}
```

### 20.4 GET /api/bot-control/rules

Response:

```json
{
  "rules": []
}
```

### 20.5 GET /api/bot-control/knowledge/sources

Query:

```text
q
type
status
topic
page
limit
```

Response:

```json
{
  "items": [],
  "page": 1,
  "limit": 50,
  "total": 120
}
```

### 20.6 GET /api/bot-control/knowledge/chunks

Query:

```text
sourceId
q
topic
page
limit
```

Response:

```json
{
  "items": [],
  "page": 1,
  "limit": 50,
  "total": 120
}
```

### 20.7 GET /api/bot-control/decisions

Query:

```text
status
mode
conversationId
dateFrom
dateTo
page
limit
```

Response:

```json
{
  "items": [],
  "page": 1,
  "limit": 50,
  "total": 120
}
```

### 20.8 POST /api/bot-control/simulate

Sudah dijelaskan di section 13.

### 20.9 GET /api/bot-control/export-docs

Response:

```text
Content-Type: text/markdown
```

## 21. Testing Plan

Gunakan Vitest.

Test wajib:

### 21.1 Unit tests

```text
src/lib/bot-control/existing-flow-registry.test.ts
src/lib/bot-control/rule-registry.test.ts
src/lib/bot-control/knowledge-indexer.test.ts
src/lib/bot-control/decision-recorder.test.ts
src/lib/bot-control/simulator.test.ts
src/lib/bot-control/channel-capabilities.test.ts
src/lib/outbound/queue.test.ts
src/lib/outbound/worker.test.ts
src/lib/outbound/safety-guard.test.ts
```

Assertions:

1. Flow registry memiliki semua node wajib.
2. Rule registry memiliki semua rule wajib.
3. Knowledge indexer tidak membuat duplicate chunk.
4. Decision recorder menyimpan status benar.
5. Simulator tidak memanggil sendMessage.
6. Capability matrix mengembalikan official-only dengan benar.
7. Outbound queue retry sesuai jadwal.
8. Safety guard block opt-out campaign.

### 21.2 Route tests

```text
src/app/api/bot-control/overview/route.test.ts
src/app/api/bot-control/flows/route.test.ts
src/app/api/bot-control/rules/route.test.ts
src/app/api/bot-control/knowledge/sources/route.test.ts
src/app/api/bot-control/decisions/route.test.ts
src/app/api/bot-control/simulate/route.test.ts
src/app/api/bot-control/export-docs/route.test.ts
```

Assertions:

1. Unauthorized user diarahkan atau ditolak sesuai pattern existing.
2. AGENT bisa read-only.
3. ADMIN bisa menjalankan simulate dan export.
4. Response shape sesuai contract.
5. Error response selalu `{ error: string }`.

### 21.3 Component tests

```text
src/components/bot-control/FlowStepList.test.tsx
src/components/bot-control/KnowledgeSourceTable.test.tsx
src/components/bot-control/DecisionTracePanel.test.tsx
src/components/bot-control/TestLab.test.tsx
src/components/bot-control/RuleRegistryTable.test.tsx
```

Assertions:

1. Flow step tampil sesuai urutan.
2. Knowledge table bisa search/filter.
3. Trace panel tidak crash jika data kosong.
4. Test Lab menampilkan hasil simulasi.
5. Rule table membedakan editable dan read-only.

## 22. Acceptance Criteria Global

Fase ini selesai jika:

1. Menu `Bot Control` tersedia.
2. Existing bot flow bisa dilihat operator.
3. Existing bot rules bisa dilihat operator.
4. Existing catalog/knowledge bisa dicari dan dibaca operator.
5. Bot decision logs tersimpan dan bisa dibuka.
6. Bubble bot di inbox punya trace viewer.
7. Test Lab bisa menjalankan simulasi tanpa kirim WhatsApp.
8. Documentation export tersedia.
9. Default outbound policy jelas: Unofficial default, Official reserved.
10. Dasar outbound queue untuk Unofficial tersedia.
11. Semua test lulus.
12. Tidak ada perubahan perilaku bot live kecuali perubahan yang disengaja dan tercatat.

## 23. Urutan Eksekusi Developer

### Phase 1: Read-only visibility

Goal:

Membuka existing logic tanpa mengubah behavior.

Tasks:

1. Tambah menu `Bot Control`.
2. Buat `existing-flow-registry.ts`.
3. Buat `rule-registry.ts`.
4. Buat API flows dan rules.
5. Buat UI Flow Map.
6. Buat UI Rules Registry.
7. Tambah component tests.

Definition of done:

1. Flow existing terlihat.
2. Rules existing terlihat.
3. Tidak ada perubahan send/bot behavior.

### Phase 2: Knowledge visibility

Goal:

Membuka knowledge/catalog yang sudah ada.

Tasks:

1. Tambah model `KnowledgeSource`.
2. Tambah model `KnowledgeChunk`.
3. Buat migration.
4. Buat `knowledge-indexer.ts`.
5. Buat API knowledge sources/chunks.
6. Buat UI Knowledge Explorer.
7. Tambah tombol sync/index catalog.
8. Tambah tests.

Definition of done:

1. Semua catalog JSON bisa terlihat di UI.
2. Operator bisa search knowledge.
3. Source path terlihat.

### Phase 3: Decision trace and logs

Goal:

Membuat alasan bot bisa diaudit.

Tasks:

1. Tambah model `BotDecisionRun`.
2. Buat `decision-recorder.ts`.
3. Integrasi recorder ke `runBotForConversation`.
4. Buat API decisions.
5. Buat UI Decision Logs.
6. Upgrade `BotTracePopover`.
7. Tambah link trace dari bubble bot.
8. Tambah tests.

Definition of done:

1. Setiap bot run baru tercatat.
2. Agent bisa lihat alasan bot dari inbox.
3. Admin bisa audit semua bot run.

### Phase 4: Test Lab

Goal:

Menguji bot tanpa kirim WhatsApp.

Tasks:

1. Buat `simulator.ts`.
2. Buat API simulate.
3. Buat UI Test Lab.
4. Tambah context selector.
5. Tambah flow/knowledge/verification output.
6. Tambah tests untuk memastikan tidak ada sendMessage.

Definition of done:

1. Admin bisa mengetes pesan.
2. Hasil simulasi menampilkan reply dan trace.
3. Tidak ada outbound WhatsApp.

### Phase 5: Documentation export

Goal:

Membuat dokumentasi hidup.

Tasks:

1. Buat `documentation-exporter.ts`.
2. Buat API export docs.
3. Buat UI documentation preview.
4. Tambah download/copy.
5. Tambah tests.

Definition of done:

1. Admin bisa export Markdown.
2. Dokumen berisi flow, rules, knowledge, settings, gaps.

### Phase 6: WhatsApp channel policy and outbound queue

Goal:

Menguatkan penggunaan Unofficial sebagai outbound utama.

Tasks:

1. Buat channel capability matrix.
2. Tambah model `OutboundJob`.
3. Buat queue/worker/retry policy.
4. Ubah Unofficial send agar lewat queue.
5. Tambah failed/retry UI.
6. Tambah safety guard awal.
7. Tambah tests.

Definition of done:

1. Unofficial send tidak lagi bergantung direct fire-and-forget.
2. Gagal kirim bisa retry.
3. Channel policy terlihat di Bot Control.

## 24. Risiko Dan Mitigasi

### Risiko 1: Behavior bot berubah saat visibility dibuat

Mitigasi:

1. Phase 1 hanya read-only.
2. Jangan ubah orchestrator kecuali untuk record trace.
3. Tambahkan regression tests.

### Risiko 2: Knowledge index tidak sama dengan knowledge runtime

Mitigasi:

1. Simpan `sourcePath` dan hash.
2. Jangan jadikan index sebagai source runtime dulu.
3. Tandai UI sebagai explorer dari catalog aktif.

### Risiko 3: Trace menampilkan data sensitif

Mitigasi:

1. Buat sanitizer untuk trace.
2. Jangan tampilkan token/API key.
3. Booking data tampil ringkas.

### Risiko 4: Queue membuat pesan terlambat

Mitigasi:

1. Job attempt pertama immediate.
2. UI langsung menampilkan message dengan status pending/sending.
3. Worker interval pendek.

### Risiko 5: Unofficial provider punya limit tidak jelas

Mitigasi:

1. Tambah rate limit konservatif.
2. Tambah pause otomatis saat error tinggi.
3. Tambah per-provider config.

## 25. Usulan Setelah WhatsApp Stabil

Simpan usulan ini. Jangan dikerjakan sebelum WhatsApp Control Center dan outbound queue stabil.

### 25.1 Campaign WhatsApp aman

Fitur:

1. Segment contacts.
2. Draft campaign.
3. Batch kecil.
4. Throttle.
5. Reply tracking.
6. Opt-out.
7. Official template fallback.

### 25.2 Automation rules

Fitur:

1. Trigger: message received.
2. Trigger: label added.
3. Trigger: stage changed.
4. Trigger: bot handoff.
5. Action: assign agent.
6. Action: add label.
7. Action: create reminder.
8. Action: send message/template.
9. Action: call webhook/n8n.

### 25.3 Flow builder

Setelah flow map stabil:

1. Buat visual builder.
2. Draft/published versioning.
3. Test before publish.
4. Rollback.
5. Analytics per node.

### 25.4 Omnichannel

Prioritas setelah WhatsApp:

1. Instagram DM.
2. Facebook Messenger.
3. Web chat widget.
4. Email.
5. SMS.

## 26. Checklist Akhir Untuk Tim Developer

Sebelum merge:

1. Jalankan `npm test`.
2. Jalankan `npx tsc --noEmit`.
3. Jalankan `npx eslint`.
4. Pastikan migration Prisma dibuat.
5. Pastikan tidak ada secret di UI/API.
6. Pastikan simulator tidak mengirim WhatsApp.
7. Pastikan Unofficial tetap default outbound.
8. Pastikan Official tetap bisa dipakai untuk template/capability.
9. Pastikan AGENT read-only untuk area berisiko.
10. Pastikan ADMIN punya kontrol sync/export/simulate.

## 27. Definition Of Success

Project ini sukses jika owner/operator bisa menjawab pertanyaan berikut tanpa membuka kode:

1. Bot punya flow apa saja?
2. Bot menjawab berdasarkan knowledge apa?
3. Kenapa bot menjawab seperti itu?
4. Kenapa bot handoff?
5. Kenapa bot tidak menjawab?
6. Knowledge mana yang kurang?
7. Pesan mana yang gagal terkirim?
8. Jalur pengiriman mana yang dipakai?
9. Fitur mana yang official-only?
10. Apakah perubahan bot aman sebelum dipakai live?

Jika semua pertanyaan ini bisa dijawab dari UI, maka `wa-inbox` sudah bergerak dari chatbot tersembunyi menjadi platform WhatsApp yang bisa dioperasikan secara real.

