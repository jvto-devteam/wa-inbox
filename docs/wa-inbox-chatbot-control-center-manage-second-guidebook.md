> # ⚠️ STATUS DOKUMEN: SEBAGIAN BESAR DIBATALKAN (2026-09-08)
>
> **Ini dokumen desain historis. Jangan dipakai sebagai instruksi implementasi.**
> Sumber kebenaran adalah [`CLAUDE.md`](../CLAUDE.md) dan kode itu sendiri.
>
> Dokumen ini ditulis 2026-09-07 dan diimplementasikan sebagai fase A–H. Pada **2026-09-08**
> sebuah audit produk membatalkan sebagian besar isinya lewat refactor right-sizing, dan
> kode yang dijelaskan di bawah **sudah dihapus dari repo**.
>
> ## Kenapa dibatalkan
>
> Lapisan draft → review → approve → publish → rollback per entitas menjawab masalah SaaS
> multi-tenant. wa-inbox adalah alat internal **satu bisnis** (JVTO), single-tenant, satu tim
> kecil. Dua bukti yang menentukan:
>
> 1. Tak seorang pun bisa memegang peran selain `ADMIN` atau `AGENT`, sehingga penulis draft
>    selalu sama dengan penyetujunya. Matriks izin lima peran di section 13 mendeskripsikan
>    akun yang tidak bisa dibuat siapa pun.
> 2. Tombol Publish terbukti mengembalikan **409 di setiap penekanan** — fitur inti dari
>    seluruh fase ini tidak pernah sekali pun berhasil dijalankan, dan tidak ada yang
>    melaporkannya.
>
> ## Yang SUDAH TIDAK BERLAKU dari dokumen ini
>
> - Seluruh siklus draft → review → approve → publish → rollback, untuk semua entitas.
> - Model: `BotRelease`, `BotRuleSetting`, `BotFlowDefinition`, `BotFlowVersion`,
>   `BotTestCase`, `BotTestRun`, `BotTestResult`, `BotDecisionTriage`, `ChannelPolicySetting`.
> - Permission matrix (section 13) dan peran `BOT_MANAGER` / `OWNER`. Otorisasi sekarang satu
>   fungsi: `hasAdminPowers()`.
> - Test suite sebagai gate publish, dan override Owner atas test yang gagal.
> - Documentation Export, halaman Triage Queue, `/settings/bot-log`,
>   `/bot-control/channel-policy`, `/bot-control/releases`, `/bot-control/docs`.
> - Audit log `before`/`after` diff, `ipAddress`, `userAgent`.
> - Knowledge workflow enam status. Sekarang `DRAFT` / `PUBLISHED` (+ `ARCHIVED` yang ditulis
>   sistem, bukan dipilih operator).
>
> ## Yang MASIH BERLAKU, dalam bentuk yang disederhanakan
>
> - `BotControlAuditLog` — tinggal lima kolom (waktu, siapa, aksi, entitas, alasan), `reason`
>   tetap lewat `sanitizeTrace`, dipangkas 365 hari.
> - `KnowledgeRevision` — versioning dipertahankan penuh; revisi `PUBLISHED` immutable.
> - Rule, flow safe config, dan channel policy — jadi kolom biasa di `Settings`, diedit di
>   `/chatbot` dan `/settings` dengan pola **edit → simpan → aktif**. Batas min/max pengaman
>   outbound dipertahankan (`src/lib/outbound/safety-bounds.ts`).
> - Triage — dua kolom `BotDecisionRun.flaggedAt` / `flagNote`.
> - Stuck outbound recovery (§8.7, ambang 5 menit) — dipertahankan, definisinya diekstrak ke
>   `src/lib/outbound/stuck.ts`.
> - Outbound queue, worker, retry, safety guard, decision logs, trace viewer, simulator,
>   Test Lab, `npm run eval`, registry statis.
>
> **Jangan bangun ulang apa pun dari daftar "sudah tidak berlaku" di atas.** Alasannya ada di
> `CLAUDE.md` section 3.

# Technical Design Document: Wa-Inbox Chatbot Control Center - Manage Second

Tanggal dokumen: 2026-09-07

Repo acuan: `jvto-devteam/wa-inbox`

Status dokumen: siap diberikan ke tim developer

Fokus fase: membuat semua yang sudah terlihat menjadi bisa dikontrol, diuji, dipublish, diaudit, dan di-rollback.

---

## 1. Ringkasan Eksekutif

Fase sebelumnya sudah membuka bagian penting dari chatbot yang sebelumnya tersembunyi:

1. Existing flow.
2. Bot rules.
3. Knowledge/catalog.
4. Decision trace.
5. Test Lab.
6. Channel capability WhatsApp Official vs Unofficial.
7. Outbound queue/retry.

Fase ini bukan lagi sekadar menampilkan. Fase ini mengubah Bot Control Center menjadi control plane yang bisa dipakai tim operasional dan developer untuk mengelola chatbot secara aman.

Target utama:

1. Rule bisa dikelola dari UI, bukan hanya dibaca dari kode.
2. Knowledge bisa dibuat, diedit, direview, dipublish, dan di-rollback.
3. Flow existing bisa diberi versi, diuji, dipublish, dan dikembalikan ke versi sebelumnya.
4. Test Lab bisa menyimpan test case dan menjalankan regression test.
5. Decision log bisa ditindaklanjuti menjadi task perbaikan knowledge/rule/flow.
6. Semua perubahan penting masuk audit log.
7. Semua publish harus punya release record.
8. WhatsApp Unofficial tetap menjadi outbound default, tetapi dijaga oleh safety guard yang dapat dikonfigurasi.
9. WhatsApp Official tetap diposisikan sebagai inbound webhook dan official capability layer.

Prinsip produk:

1. Expose first sudah dimulai.
2. Manage second adalah scope dokumen ini.
3. Extend third baru dilakukan setelah control plane stabil.

---

## 2. Konteks Produk

`wa-inbox` adalah aplikasi inbox dan chatbot WhatsApp.

Strategi WhatsApp:

1. WhatsApp Official digunakan sebagai jalur inbound webhook untuk menerima pesan dan event.
2. WhatsApp Unofficial atau coexistence digunakan sebagai jalur outbound utama untuk balasan harian agent dan bot.
3. WhatsApp Official tetap tersedia untuk fitur resmi seperti template, interactive message, campaign legal, delivery/read status, dan fitur yang memang tidak dapat dikirim lewat Unofficial.

Referensi produk:

1. WATI: visual chatbot builder berbasis block, flow, question, reply, dan dashboard management.
2. Astra WATI: AI Agent berbasis knowledge, riwayat percakapan, CRM, lead qualification, dan handoff.
3. respond.io: AI Objective, approved knowledge source, failure condition, routing, CRM/lifecycle update, dan human handoff.
4. Kirim.Chat: WhatsApp-first operational tooling, cocok sebagai referensi segmentasi, broadcast, dan automation lokal.
5. Bird: customer engagement platform dengan omnichannel, automation, dan lifecycle messaging sebagai referensi jangka panjang.

Catatan:

Fokus implementasi tetap WhatsApp dulu. Omnichannel hanya disiapkan sebagai future-proofing ringan di model data dan boundary service.

---

## 3. Kondisi Repo Saat Ini

Repo sudah memiliki fondasi fase expose:

1. Bot Control UI:
   - `src/app/(authenticated)/bot-control/page.tsx`
   - `src/app/(authenticated)/bot-control/flows/page.tsx`
   - `src/app/(authenticated)/bot-control/knowledge/page.tsx`
   - `src/app/(authenticated)/bot-control/decisions/page.tsx`
   - `src/app/(authenticated)/bot-control/rules/page.tsx`
   - `src/app/(authenticated)/bot-control/test-lab/page.tsx`
   - `src/app/(authenticated)/bot-control/docs/page.tsx`

2. Bot Control API:
   - `src/app/api/bot-control/flows`
   - `src/app/api/bot-control/knowledge`
   - `src/app/api/bot-control/decisions`
   - `src/app/api/bot-control/rules`
   - `src/app/api/bot-control/simulate`
   - `src/app/api/bot-control/export-docs`

3. Bot Control library:
   - `src/lib/bot-control/channel-capabilities.ts`
   - `src/lib/bot-control/rule-registry.ts`
   - `src/lib/bot-control/knowledge-indexer.ts`
   - `src/lib/bot-control/simulator.ts`
   - `src/lib/bot-control/decision-recorder.ts`
   - `src/lib/bot-control/documentation-exporter.ts`
   - `src/lib/bot-control/trace-sanitizer.ts`

4. Outbound queue:
   - `src/lib/outbound/queue.ts`
   - `src/lib/outbound/worker.ts`
   - `src/lib/outbound/safety-guard.ts`
   - `src/lib/outbound/retry-policy.ts`
   - `src/app/api/outbound-jobs/process/route.ts`
   - `src/app/api/outbound-jobs/retry/route.ts`

5. Prisma model penting yang sudah ada:
   - `OutboundJob`
   - `ContactConsent`
   - `BotDecisionRun`
   - `KnowledgeSource`
   - `KnowledgeChunk`

Masalah fase saat ini:

1. Registry rule masih banyak yang statis.
2. KnowledgeSource masih mirror dari `catalog/*.json`, belum menjadi managed knowledge.
3. Flow map masih read-only.
4. Test Lab belum menjadi test suite.
5. Decision logs belum punya triage workflow.
6. Publish, rollback, dan audit log belum menjadi konsep utama.
7. Channel policy belum dikelola sebagai konfigurasi runtime yang terkontrol.

---

## 4. Tujuan Fase Manage Second

Tujuan wajib:

1. Membuat control plane untuk bot.
2. Membuat semua perubahan bot berjalan lewat draft -> test -> review -> publish.
3. Membuat semua entity yang mengubah perilaku bot memiliki versioning.
4. Membuat semua publish memiliki rollback path.
5. Membuat semua perubahan penting tercatat di audit log.
6. Membuat dashboard operasional untuk outbound safety dan retry.
7. Membuat Test Lab menjadi regression test suite.

Non-goal:

1. Tidak membuat full drag-and-drop builder dulu.
2. Tidak menjadikan Unofficial sebagai jalur campaign massal tanpa throttling.
3. Tidak menghapus jalur Official.
4. Tidak mengganti total orchestrator bot dalam satu fase.
5. Tidak membuat omnichannel production di fase ini.

---

## 5. Prinsip Arsitektur

Gunakan tiga lapisan:

1. Runtime Plane
   - Kode yang benar-benar menjawab customer.
   - Contoh: orchestrator, channel router, send path, safety guard, knowledge retrieval.

2. Control Plane
   - UI/API untuk mengatur konfigurasi, rule, knowledge, flow, test case, dan channel policy.
   - Semua perubahan dibuat sebagai draft lebih dulu.

3. Audit Plane
   - Record permanen untuk siapa mengubah apa, kapan, dari nilai apa ke nilai apa, dan release apa yang mengaktifkannya.

Aturan:

1. Operator tidak boleh langsung mengubah runtime tanpa draft.
2. Draft tidak boleh aktif sebelum publish.
3. Publish tidak boleh jalan kalau regression test gagal, kecuali admin melakukan override dengan alasan tertulis.
4. Setiap publish harus bisa rollback ke release sebelumnya.
5. Setiap perubahan harus memiliki actor.

---

## 6. Struktur Menu Baru

Tambahkan atau lengkapi menu `Bot Control` menjadi:

1. Overview
2. Rules
3. Knowledge
4. Flows
5. Test Lab
6. Decision Logs
7. Outbound Queue
8. Channel Policy
9. Releases
10. Audit Logs
11. Documentation

Urutan sidebar yang direkomendasikan:

1. Inbox
2. Contacts
3. Templates
4. Bot Control
5. Campaigns
6. Settings

Catatan:

`Campaigns` boleh tetap placeholder sampai Extend Third. Namun Outbound Queue harus tersedia di fase ini karena WhatsApp Unofficial butuh safety control.

---

## 7. Model Data Baru

Tambahkan model Prisma berikut.

### 7.1 BotControlAuditLog

Tujuan:

Menyimpan semua perubahan penting di Bot Control.

```prisma
model BotControlAuditLog {
  id          String   @id @default(cuid())
  actorId     String?
  actorName   String?
  action      String
  entityType  String
  entityId    String?
  entityKey   String?
  before      Json?
  after       Json?
  reason      String?
  releaseId   String?
  ipAddress   String?
  userAgent   String?
  createdAt   DateTime @default(now())

  @@index([entityType, entityId])
  @@index([entityKey])
  @@index([action])
  @@index([releaseId])
  @@index([createdAt])
}
```

Action value:

1. `CREATE_DRAFT`
2. `UPDATE_DRAFT`
3. `REQUEST_REVIEW`
4. `APPROVE`
5. `REJECT`
6. `PUBLISH`
7. `ROLLBACK`
8. `ENABLE`
9. `DISABLE`
10. `RUN_TEST`
11. `OVERRIDE_TEST_FAILURE`

### 7.2 BotRelease

Tujuan:

Menyimpan snapshot publish untuk rule, knowledge, flow, dan channel policy.

```prisma
model BotRelease {
  id            String   @id @default(cuid())
  version       Int      @unique
  title         String
  description   String?
  status        String   @default("PUBLISHED")
  publishedBy   String?
  publishedAt   DateTime @default(now())
  rollbackOfId  String?
  testRunId     String?
  snapshot      Json
  notes         String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@index([status])
  @@index([publishedAt])
}
```

Status:

1. `PUBLISHED`
2. `ROLLED_BACK`
3. `SUPERSEDED`

Snapshot wajib berisi:

1. Active rule versions.
2. Active knowledge versions.
3. Active flow versions.
4. Active channel policy.
5. Test summary.

### 7.3 BotRuleSetting

Tujuan:

Mengubah rule yang saat ini statis menjadi rule yang bisa dikontrol jika aman.

```prisma
model BotRuleSetting {
  id              String   @id @default(cuid())
  key             String   @unique
  name            String
  category        String
  description     String
  severity        String
  editable        Boolean  @default(false)
  enabled         Boolean  @default(true)
  config          Json?
  runtimeSource   String?
  status          String   @default("PUBLISHED")
  draftConfig     Json?
  draftEnabled    Boolean?
  draftUpdatedBy  String?
  draftUpdatedAt  DateTime?
  publishedBy     String?
  publishedAt     DateTime?
  releaseId       String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@index([category])
  @@index([severity])
  @@index([status])
}
```

Status:

1. `DRAFT`
2. `REVIEW`
3. `PUBLISHED`
4. `ARCHIVED`

Rule yang boleh masuk management fase ini:

1. `channel.unofficial_outbound_default`
2. `channel.official_reserved_for_capabilities`
3. `bot.handoff_on_human_request`
4. `bot.skip_indonesian_numbers`

Rule yang tidak boleh editable:

1. `bot.no_invented_price`
2. `bot.no_invented_url`
3. `bot.booking_context_first`
4. `bot.rate_limit` sampai config dipindahkan ke DB dengan benar.
5. `bot.burst_debounce` sampai window dipindahkan ke DB dengan benar.

### 7.4 ManagedKnowledgeSource

Tujuan:

Membedakan knowledge mirror dari `catalog/*.json` dengan knowledge yang benar-benar dikelola operator.

Catatan:

Model `KnowledgeSource` yang sudah ada tetap dipertahankan. Tambahkan field baru jika memungkinkan, atau buat model baru. Rekomendasi aman: extend `KnowledgeSource`.

Tambahkan field ke `KnowledgeSource`:

```prisma
model KnowledgeSource {
  // existing fields tetap ada
  ownerId          String?
  lifecycle        String   @default("PUBLISHED")
  activeVersionId  String?
  createdBy        String?
  approvedBy       String?
  approvedAt       DateTime?
  archivedAt       DateTime?
}
```

Jika migration lebih aman dengan model baru:

```prisma
model KnowledgeRevision {
  id                String   @id @default(cuid())
  knowledgeSourceId String
  version           Int
  title             String
  body              Json
  summary           String?
  status            String   @default("DRAFT")
  changeReason      String?
  createdBy         String?
  reviewedBy        String?
  reviewedAt        DateTime?
  publishedBy       String?
  publishedAt       DateTime?
  releaseId         String?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  @@unique([knowledgeSourceId, version])
  @@index([knowledgeSourceId])
  @@index([status])
  @@index([releaseId])
}
```

Status:

1. `DRAFT`
2. `REVIEW`
3. `APPROVED`
4. `PUBLISHED`
5. `ARCHIVED`
6. `REJECTED`

### 7.5 BotFlowDefinition

Tujuan:

Membuat flow existing bisa dikelola dan diberi versi tanpa membangun full visual builder dulu.

```prisma
model BotFlowDefinition {
  id              String   @id @default(cuid())
  key             String   @unique
  name            String
  description     String?
  category        String?
  runtimeSource   String?
  editableLevel   String   @default("READ_ONLY")
  activeVersionId String?
  status          String   @default("PUBLISHED")
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@index([category])
  @@index([status])
}
```

Editable level:

1. `READ_ONLY`
2. `TEXT_ONLY`
3. `SAFE_CONFIG`
4. `FLOW_BUILDER_V1`

### 7.6 BotFlowVersion

```prisma
model BotFlowVersion {
  id              String   @id @default(cuid())
  flowId          String
  version         Int
  status          String   @default("DRAFT")
  triggerConfig   Json?
  nodeConfig      Json
  edgeConfig      Json?
  fallbackConfig  Json?
  handoffConfig   Json?
  changeReason    String?
  createdBy       String?
  reviewedBy      String?
  reviewedAt      DateTime?
  publishedBy     String?
  publishedAt     DateTime?
  releaseId       String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@unique([flowId, version])
  @@index([flowId])
  @@index([status])
  @@index([releaseId])
}
```

Status:

1. `DRAFT`
2. `REVIEW`
3. `APPROVED`
4. `PUBLISHED`
5. `ARCHIVED`
6. `REJECTED`

### 7.7 BotTestCase

```prisma
model BotTestCase {
  id               String   @id @default(cuid())
  name             String
  description      String?
  category         String?
  inputText        String
  conversationSeed Json?
  expectedStatus   String?
  expectedFlowKey  String?
  expectedContains String?
  expectedNotContains String?
  expectedHandoff  Boolean?
  requiredKnowledgeKeys Json?
  enabled          Boolean  @default(true)
  createdBy        String?
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  @@index([category])
  @@index([enabled])
}
```

### 7.8 BotTestRun

```prisma
model BotTestRun {
  id          String   @id @default(cuid())
  name        String?
  scope       String
  status      String
  total       Int      @default(0)
  passed      Int      @default(0)
  failed      Int      @default(0)
  skipped     Int      @default(0)
  releaseId   String?
  startedBy   String?
  startedAt   DateTime @default(now())
  finishedAt  DateTime?
  summary     Json?
  createdAt   DateTime @default(now())

  @@index([scope])
  @@index([status])
  @@index([releaseId])
}
```

### 7.9 BotTestResult

```prisma
model BotTestResult {
  id             String   @id @default(cuid())
  testRunId      String
  testCaseId     String
  status         String
  inputText      String
  actualStatus   String?
  actualFlowKey  String?
  actualReply    String?
  actualTrace    Json?
  failureReason  String?
  latencyMs      Int?
  createdAt      DateTime @default(now())

  @@index([testRunId])
  @@index([testCaseId])
  @@index([status])
}
```

### 7.10 BotDecisionTriage

```prisma
model BotDecisionTriage {
  id              String   @id @default(cuid())
  decisionRunId   String   @unique
  status          String   @default("OPEN")
  issueType       String?
  severity        String   @default("NORMAL")
  assignedTo      String?
  note            String?
  linkedEntityType String?
  linkedEntityId   String?
  resolvedBy      String?
  resolvedAt      DateTime?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@index([status])
  @@index([issueType])
  @@index([severity])
  @@index([assignedTo])
}
```

Issue type:

1. `KNOWLEDGE_GAP`
2. `WRONG_FLOW`
3. `BAD_REPLY`
4. `HALLUCINATION_BLOCKED`
5. `UNNECESSARY_HANDOFF`
6. `MISSED_HANDOFF`
7. `PROVIDER_FAILURE`
8. `OTHER`

### 7.11 ChannelPolicySetting

```prisma
model ChannelPolicySetting {
  id              String   @id @default(cuid())
  key             String   @unique
  defaultOutbound String   @default("UNOFFICIAL")
  officialMode    String   @default("INBOUND_AND_CAPABILITY")
  unofficialMode  String   @default("PRIMARY_OUTBOUND")
  capabilityRules Json
  safetyConfig    Json
  status          String   @default("PUBLISHED")
  draftConfig     Json?
  publishedBy     String?
  publishedAt     DateTime?
  releaseId       String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}
```

Default initial row:

```json
{
  "key": "whatsapp.default",
  "defaultOutbound": "UNOFFICIAL",
  "officialMode": "INBOUND_AND_CAPABILITY",
  "unofficialMode": "PRIMARY_OUTBOUND",
  "capabilityRules": {
    "send_text": "UNOFFICIAL",
    "send_media": "UNOFFICIAL",
    "send_document": "UNOFFICIAL",
    "send_audio": "UNOFFICIAL",
    "send_template": "OFFICIAL",
    "send_buttons": "OFFICIAL",
    "send_list": "OFFICIAL",
    "send_carousel": "OFFICIAL",
    "campaign": "UNOFFICIAL_LIMITED"
  },
  "safetyConfig": {
    "campaignRatePerMinute": 20,
    "duplicateWindowMs": 60000,
    "providerFailureThreshold": 5,
    "providerFailureWindowMs": 300000,
    "quietHoursEnabled": false
  }
}
```

---

## 8. API Design

Semua endpoint berada di bawah:

`/api/bot-control`

Semua mutation wajib:

1. Require auth.
2. Validate role.
3. Validate request body dengan schema.
4. Tulis audit log.
5. Tidak langsung mengubah runtime kecuali action `publish`.

### 8.1 Rules API

#### GET `/api/bot-control/rules`

Fungsi:

Mengembalikan rule registry yang sudah dilapisi dengan setting database.

Response:

```json
{
  "rules": [
    {
      "key": "channel.unofficial_outbound_default",
      "name": "Unofficial sebagai outbound default",
      "category": "Channel Policy",
      "editable": true,
      "enabled": true,
      "status": "PUBLISHED",
      "config": {
        "policyDefaultChannel": "UNOFFICIAL",
        "liveDefaultChannel": "UNOFFICIAL"
      },
      "hasDraft": false
    }
  ]
}
```

#### PATCH `/api/bot-control/rules/:key/draft`

Fungsi:

Membuat atau mengubah draft rule.

Body:

```json
{
  "enabled": true,
  "config": {
    "liveDefaultChannel": "UNOFFICIAL"
  },
  "reason": "Menjaga outbound harian tetap lewat coexistence."
}
```

Validasi:

1. Rule harus ada.
2. Rule harus `editable: true`.
3. Config hanya boleh key yang didukung.
4. Actor harus role `OWNER`, `ADMIN`, atau `BOT_MANAGER`.

#### POST `/api/bot-control/rules/:key/request-review`

Mengubah status draft menjadi `REVIEW`.

#### POST `/api/bot-control/rules/:key/approve`

Mengubah status menjadi `APPROVED`.

#### POST `/api/bot-control/rules/:key/reject`

Mengubah status menjadi `REJECTED`.

#### POST `/api/bot-control/rules/:key/publish`

Tidak dipanggil langsung dari UI rule. Publish dilakukan lewat release API agar rule, knowledge, flow, dan channel policy bisa dipublish sebagai satu paket.

### 8.2 Knowledge API

#### GET `/api/bot-control/knowledge/sources`

Tambahkan filter:

1. `type`
2. `status`
3. `lifecycle`
4. `q`
5. `ownerId`
6. `hasDraft`

#### POST `/api/bot-control/knowledge/sources`

Membuat managed knowledge source.

Body:

```json
{
  "title": "FAQ Harga Paket ATV",
  "type": "FAQ",
  "summary": "Jawaban resmi untuk pertanyaan harga paket ATV.",
  "body": {
    "items": [
      {
        "question": "Berapa harga ATV?",
        "answer": "Harga mengikuti paket yang tersedia di katalog aktif."
      }
    ]
  },
  "reason": "Menutup knowledge gap dari customer yang sering bertanya harga ATV."
}
```

#### PATCH `/api/bot-control/knowledge/sources/:id/draft`

Mengubah draft revision.

#### POST `/api/bot-control/knowledge/sources/:id/request-review`

Kirim revision ke review.

#### POST `/api/bot-control/knowledge/sources/:id/approve`

Approve revision.

#### POST `/api/bot-control/knowledge/sources/:id/archive`

Archive source, tapi tidak menghapus audit dan revision.

### 8.3 Flow API

#### GET `/api/bot-control/flows`

Response harus menampilkan:

1. Flow key.
2. Flow name.
3. Runtime source.
4. Editable level.
5. Active version.
6. Draft version jika ada.
7. Last published at.
8. Test status terakhir.

#### GET `/api/bot-control/flows/:key`

Response detail:

1. Definition.
2. Active version.
3. Draft version.
4. Nodes.
5. Edges.
6. Linked rules.
7. Linked knowledge.
8. Recent decision runs.
9. Related test cases.

#### PATCH `/api/bot-control/flows/:key/draft`

Fase ini hanya mengizinkan safe config:

1. Greeting text.
2. Clarification prompt.
3. Fallback reply.
4. Handoff text.
5. Working hours reply.
6. Max clarification attempts.
7. Required fields for lead qualification.

Tidak boleh mengubah branching logic kompleks sebelum Flow Builder V1.

### 8.4 Test Lab API

#### POST `/api/bot-control/test-cases`

Menyimpan test case dari hasil simulasi.

Body:

```json
{
  "name": "Harga ATV harus memakai knowledge resmi",
  "category": "Pricing",
  "inputText": "Berapa harga ATV?",
  "expectedStatus": "REPLIED",
  "expectedContains": "Rp",
  "expectedNotContains": "tidak tahu",
  "expectedHandoff": false
}
```

#### POST `/api/bot-control/test-runs`

Menjalankan banyak test case.

Body:

```json
{
  "scope": "PRE_RELEASE",
  "testCaseIds": ["case_1", "case_2"],
  "candidate": {
    "ruleDraftKeys": ["channel.unofficial_outbound_default"],
    "knowledgeRevisionIds": ["rev_1"],
    "flowVersionIds": ["flow_ver_1"]
  }
}
```

Response:

```json
{
  "testRunId": "run_1",
  "status": "PASSED",
  "total": 10,
  "passed": 10,
  "failed": 0
}
```

### 8.5 Release API

#### GET `/api/bot-control/releases`

List release.

#### POST `/api/bot-control/releases/preview`

Membuat preview perubahan yang akan dipublish.

Response:

```json
{
  "changes": {
    "rules": 2,
    "knowledge": 3,
    "flows": 1,
    "channelPolicy": 1
  },
  "requiresTestRun": true,
  "blockingIssues": []
}
```

#### POST `/api/bot-control/releases`

Publish perubahan yang sudah approved dan sudah lulus test.

Body:

```json
{
  "title": "Release Bot Control 2026-09-07",
  "description": "Publish rule channel policy, FAQ ATV, dan fallback handoff.",
  "approvedEntityIds": ["rule_1", "knowledge_rev_1", "flow_ver_1"],
  "testRunId": "run_1",
  "notes": "Sudah diuji untuk pricing, handoff, dan fallback."
}
```

Validasi publish:

1. Semua entity harus status `APPROVED`.
2. Test run harus `PASSED`.
3. Jika test gagal, hanya role `OWNER` yang boleh override.
4. Override wajib punya `reason`.
5. Snapshot release harus ditulis dalam satu transaksi.

#### POST `/api/bot-control/releases/:id/rollback`

Rollback ke release tertentu.

Body:

```json
{
  "reason": "FAQ baru menyebabkan jawaban pricing salah."
}
```

Rollback harus:

1. Membuat BotRelease baru dengan `rollbackOfId`.
2. Mengembalikan active versions ke snapshot release target.
3. Menulis audit log.
4. Menjalankan smoke test minimal setelah rollback.

### 8.6 Decision Triage API

#### POST `/api/bot-control/decisions/:id/triage`

Body:

```json
{
  "issueType": "KNOWLEDGE_GAP",
  "severity": "HIGH",
  "assignedTo": "user_1",
  "note": "Customer tanya refund, bot belum punya jawaban resmi."
}
```

#### POST `/api/bot-control/decisions/:id/create-knowledge-draft`

Membuat knowledge draft dari decision run.

#### POST `/api/bot-control/decisions/:id/create-test-case`

Membuat test case dari inbound text dan expected behavior.

### 8.7 Outbound Queue API

Tambahkan:

1. GET `/api/outbound-jobs`
2. GET `/api/outbound-jobs/:id`
3. POST `/api/outbound-jobs/:id/retry`
4. POST `/api/outbound-jobs/:id/cancel`
5. POST `/api/outbound-jobs/recover-stuck`
6. POST `/api/outbound-jobs/pause-provider`
7. POST `/api/outbound-jobs/resume-provider`

Stuck recovery:

1. Job status `SENDING`.
2. `updatedAt` lebih lama dari 5 menit.
3. Ubah ke `RETRYING` jika attempts masih ada.
4. Ubah ke `FAILED` jika attempts habis.

---

## 9. UI Design

### 9.1 Rules Page

Tampilan:

1. Tabel rule.
2. Filter category, severity, editable, status.
3. Badge `Runtime enforced`, `Editable`, `Critical`, `Draft available`.
4. Detail drawer.

Action:

1. Edit draft.
2. Request review.
3. Approve.
4. Reject.
5. View audit.
6. View related decisions.

Form edit rule:

1. Toggle enabled jika aman.
2. Config fields sesuai schema.
3. Reason wajib.
4. Preview dampak.

Jangan tampilkan toggle untuk rule non-editable.

### 9.2 Knowledge Page

Tampilan:

1. Source list.
2. Chunk preview.
3. Revision history.
4. Status lifecycle.
5. Linked decision runs.
6. Linked test cases.

Action:

1. Create knowledge.
2. Edit draft.
3. Request review.
4. Approve.
5. Archive.
6. Restore previous version.
7. Create test case.

Editor knowledge minimal:

1. Title.
2. Summary.
3. Body.
4. FAQ items.
5. Links.
6. Price facts.
7. Tags.
8. Change reason.

### 9.3 Flows Page

Tampilan:

1. Flow list.
2. Flow detail.
3. Node map read-only.
4. Safe config editor.
5. Version history.
6. Related rules.
7. Related knowledge.
8. Test status.

Action fase ini:

1. Edit safe config.
2. Create draft version.
3. Run test.
4. Request review.
5. Approve.
6. Include in release.
7. Rollback version.

### 9.4 Test Lab Page

Tambahkan dua mode:

1. One-off simulation.
2. Saved test cases.

Untuk one-off:

1. Pilih conversation seed.
2. Input pesan.
3. Jalankan simulasi.
4. Lihat reply, trace, rule hit, knowledge refs, warnings.
5. Simpan sebagai test case.

Untuk test suite:

1. List test cases.
2. Filter by category.
3. Run selected.
4. Run pre-release suite.
5. Compare result with previous release.

### 9.5 Decision Logs Page

Tambahkan triage panel:

1. Status: open, assigned, resolved, ignored.
2. Issue type.
3. Severity.
4. Assigned user.
5. Notes.
6. Linked knowledge/rule/flow/test case.

Quick actions:

1. Create knowledge draft.
2. Create test case.
3. Mark as wrong answer.
4. Mark as successful.
5. Assign to bot manager.

### 9.6 Outbound Queue Page

Tampilan:

1. Summary cards:
   - Queued.
   - Sending.
   - Retrying.
   - Failed.
   - Cancelled.
   - Provider failure rate.

2. Job table:
   - Status.
   - Provider.
   - Channel.
   - Attempts.
   - Next attempt.
   - Last error.
   - Conversation.
   - Message.

Action:

1. Retry.
2. Cancel.
3. Recover stuck jobs.
4. Pause campaign sends.
5. Resume provider.

### 9.7 Channel Policy Page

Tampilan:

1. Matrix Official vs Unofficial.
2. Capability routing.
3. Default outbound channel.
4. Safety config.
5. Fallback behavior.

Rules:

1. Text: Unofficial.
2. Media: Unofficial.
3. Document: Unofficial.
4. Audio: Unofficial.
5. Template: Official.
6. Buttons/list/carousel: Official or text fallback.
7. Campaign: Unofficial limited with safety guard.

UI harus memberi warning saat user mencoba mengubah official menjadi default outbound.

### 9.8 Releases Page

Tampilan:

1. Release list.
2. Change summary.
3. Test run result.
4. Published by.
5. Published at.
6. Rollback action.

Action:

1. Preview release.
2. Run pre-release tests.
3. Publish.
4. Rollback.
5. Export documentation.

### 9.9 Audit Logs Page

Tampilan:

1. Timeline perubahan.
2. Filter actor, action, entity type, date.
3. Before/after diff.
4. Linked release.

Audit log tidak boleh bisa diedit dari UI.

---

## 10. Runtime Integration

### 10.1 Rule Runtime Loader

Buat file:

`src/lib/bot-control/runtime-rules.ts`

Fungsi:

```ts
export async function getRuntimeRuleConfig() {
  // load BotRuleSetting where status PUBLISHED
  // merge with static BOT_RULES
  // return typed config used by orchestrator/channel-router/safety-guard
}
```

Aturan:

1. Static registry tetap menjadi fallback.
2. DB setting hanya boleh override rule yang editable.
3. Jika DB error, runtime harus fallback ke safe default.
4. Safe default untuk outbound adalah `UNOFFICIAL`.

### 10.2 Knowledge Runtime Strategy

Fase ini menggunakan hybrid strategy:

1. Existing `catalog/*.json` tetap berjalan.
2. Managed knowledge yang sudah `PUBLISHED` mulai bisa disertakan sebagai tambahan.
3. Bot trace harus mencatat source mana yang dipakai.

Jangan langsung mengganti seluruh catalog loader.

Implementasi aman:

1. Buat `src/lib/bot/managed-knowledge.ts`.
2. Fungsi `loadPublishedManagedKnowledge()`.
3. Orchestrator menggabungkan catalog knowledge + managed knowledge.
4. Jika DB gagal, bot tetap memakai catalog existing.

### 10.3 Flow Runtime Strategy

Fase ini belum membuat full flow engine.

Yang dilakukan:

1. Existing flow tetap berasal dari orchestrator.
2. Safe config dari `BotFlowVersion` dibaca runtime.
3. Safe config dipakai untuk mengganti teks dan nilai konfigurasi yang aman.
4. Branching logic kompleks tetap di kode sampai Flow Builder V1.

Contoh safe config:

```json
{
  "fallbackReply": "Maaf, saya belum punya jawaban pasti. Saya teruskan ke admin ya.",
  "handoffReply": "Baik, saya hubungkan dengan tim kami.",
  "clarificationPrompt": "Boleh dibantu detailnya sedikit lagi?"
}
```

### 10.4 Outbound Safety Runtime

Perubahan wajib di `src/lib/outbound/safety-guard.ts`:

1. Ambil config dari `ChannelPolicySetting.safetyConfig`.
2. Exclude current `messageId` saat duplicate check.
3. Tambahkan quiet hours optional.
4. Tambahkan provider paused state.
5. Campaign harus fail closed.
6. One-to-one reply tetap warn, bukan block, kecuali provider paused total.

Tambahkan param:

```ts
export type SafetyCheckParams = {
  conversationId: string
  contactId: string
  messageId?: string
  messageText?: string
  sentBy: 'BOT' | 'AGENT'
  purpose: OutboundPurpose
}
```

Duplicate check:

```ts
where: {
  conversationId: params.conversationId,
  direction: 'OUTBOUND',
  content: params.messageText,
  id: params.messageId ? { not: params.messageId } : undefined,
  createdAt: { gte: new Date(Date.now() - duplicateWindowMs) }
}
```

### 10.5 Stuck Job Recovery

Perubahan wajib di `src/lib/outbound/worker.ts`:

Tambahkan fungsi:

```ts
export async function recoverStuckOutboundJobs(now = new Date()) {
  // find SENDING where updatedAt older than threshold
  // if attempts < maxAttempts set RETRYING and nextAttemptAt
  // else FAILED
}
```

Endpoint:

`POST /api/outbound-jobs/recover-stuck`

Cron:

Jalankan recovery sebelum `processDueOutboundJobs`.

---

## 11. Publish Flow

Semua perubahan harus melewati alur:

1. Draft
2. Review
3. Approved
4. Pre-release test
5. Publish
6. Audit
7. Documentation export

Detail:

1. Operator membuat draft.
2. Bot Manager mengirim ke review.
3. Admin approve.
4. Sistem menjalankan test suite.
5. Jika test passed, release bisa dipublish.
6. Publish menulis `BotRelease`.
7. Entity yang dipublish ditandai `PUBLISHED`.
8. Release sebelumnya ditandai `SUPERSEDED`.
9. Dokumentasi otomatis dibuat ulang.

Blocking condition:

1. Critical test failed.
2. Rule non-editable diubah.
3. Knowledge revision belum approved.
4. Flow version belum approved.
5. Channel policy mengarahkan default outbound ke Official tanpa owner override.
6. Safety config campaign rate lebih tinggi dari batas maksimal sistem.

---

## 12. Rollback Flow

Rollback harus semudah publish.

Alur:

1. Admin membuka Releases.
2. Pilih release target.
3. Klik rollback.
4. Isi reason.
5. Sistem membuat release baru dengan `rollbackOfId`.
6. Active versions dikembalikan ke snapshot target.
7. Smoke test dijalankan.
8. Audit log ditulis.

Rollback tidak boleh menghapus data.

Rollback hanya mengubah pointer:

1. `activeVersionId`.
2. Published rule config.
3. Published channel policy.
4. Release status.

---

## 13. Permission Matrix

Role minimal:

1. `OWNER`
2. `ADMIN`
3. `BOT_MANAGER`
4. `AGENT`
5. `VIEWER`

Permission:

| Action | Owner | Admin | Bot Manager | Agent | Viewer |
|---|---:|---:|---:|---:|---:|
| View Bot Control | Yes | Yes | Yes | Yes | Yes |
| Edit rule draft | Yes | Yes | Yes | No | No |
| Edit knowledge draft | Yes | Yes | Yes | Limited | No |
| Edit flow safe config | Yes | Yes | Yes | No | No |
| Create test case | Yes | Yes | Yes | Yes | No |
| Run test | Yes | Yes | Yes | Yes | No |
| Approve | Yes | Yes | No | No | No |
| Publish | Yes | Yes | No | No | No |
| Rollback | Yes | Yes | No | No | No |
| Override failed test | Yes | No | No | No | No |
| View audit logs | Yes | Yes | Yes | No | No |

---

## 14. Acceptance Criteria

### 14.1 Rules

1. User bisa melihat semua rule.
2. Rule non-editable tidak punya toggle.
3. Rule editable bisa dibuat draft.
4. Draft tidak mengubah runtime.
5. Publish mengubah runtime.
6. Semua perubahan masuk audit log.
7. Rollback mengembalikan config rule.

### 14.2 Knowledge

1. User bisa membuat knowledge baru.
2. User bisa mengedit draft tanpa memengaruhi bot live.
3. User bisa mengirim knowledge ke review.
4. Admin bisa approve.
5. Release publish membuat knowledge aktif.
6. Bot trace menampilkan knowledge source yang dipakai.
7. Knowledge bisa rollback ke revision sebelumnya.

### 14.3 Flow

1. User bisa melihat flow existing.
2. User bisa mengedit safe config.
3. Branching logic kompleks tetap read-only.
4. Flow draft bisa diuji di Test Lab.
5. Flow publish masuk release.
6. Rollback mengembalikan safe config lama.

### 14.4 Test Lab

1. Simulasi one-off tetap berjalan.
2. Simulasi bisa disimpan sebagai test case.
3. Test suite bisa dijalankan sebelum publish.
4. Result tersimpan.
5. Failed result menampilkan alasan.
6. Publish diblok jika critical test gagal.

### 14.5 Decision Logs

1. Decision run bisa ditriage.
2. Triage bisa diassign.
3. Decision run bisa dibuat menjadi knowledge draft.
4. Decision run bisa dibuat menjadi test case.
5. Resolved triage tetap tersimpan.

### 14.6 Outbound Queue

1. User bisa melihat job outbound.
2. Failed job bisa diretry.
3. Job stuck `SENDING` bisa direcover.
4. Campaign job menghormati opt-out.
5. Duplicate guard tidak memblok pesan dirinya sendiri.
6. Provider bisa dipause untuk campaign.

### 14.7 Releases

1. Release preview menampilkan perubahan.
2. Release membutuhkan test run.
3. Publish membuat snapshot.
4. Rollback membuat release baru.
5. Audit log lengkap.
6. Documentation export terupdate setelah publish.

---

## 15. Implementation Plan

### Phase A: Stabilization

Estimasi: 3-5 hari.

Task:

1. Perbaiki lint error existing.
2. Perbaiki duplicate guard dengan `messageId`.
3. Tambahkan stuck job recovery.
4. Tambahkan endpoint list outbound jobs.
5. Tambahkan test untuk duplicate guard.
6. Tambahkan test untuk stuck recovery.
7. Pastikan `npm test`, `tsc`, dan build lulus.

Output:

1. Outbound lebih aman.
2. Repo bersih untuk perubahan management layer.

### Phase B: Audit and Release Foundation

Estimasi: 5-7 hari.

Task:

1. Tambahkan model `BotControlAuditLog`.
2. Tambahkan model `BotRelease`.
3. Buat helper `writeBotAuditLog`.
4. Buat helper `createReleaseSnapshot`.
5. Buat API releases list, preview, publish, rollback.
6. Buat UI Releases.
7. Buat UI Audit Logs.

Output:

1. Semua publish punya release record.
2. Semua perubahan bisa diaudit.
3. Rollback foundation tersedia.

### Phase C: Rule Management

Estimasi: 5-7 hari.

Task:

1. Tambahkan model `BotRuleSetting`.
2. Seed rule dari `rule-registry.ts`.
3. Buat runtime rule loader.
4. Buat draft/review/approve flow.
5. Update Rules UI.
6. Integrasikan publish via Release API.
7. Tambahkan tests.

Output:

1. Rule editable bisa dikontrol.
2. Rule critical tetap terlindungi.

### Phase D: Knowledge Management

Estimasi: 7-10 hari.

Task:

1. Tambahkan `KnowledgeRevision`.
2. Tambahkan create/edit/review/approve knowledge.
3. Tambahkan revision history UI.
4. Tambahkan action create knowledge from decision.
5. Tambahkan managed knowledge runtime loader.
6. Tambahkan trace knowledge source.
7. Tambahkan tests.

Output:

1. Knowledge tidak lagi hanya mirror.
2. Knowledge gap bisa berubah menjadi knowledge published.

### Phase E: Flow Safe Config

Estimasi: 7-10 hari.

Task:

1. Tambahkan `BotFlowDefinition`.
2. Tambahkan `BotFlowVersion`.
3. Seed existing flow registry.
4. Buat safe config editor.
5. Runtime membaca safe config.
6. Tambahkan flow version history.
7. Tambahkan tests.

Output:

1. Flow existing bisa dikontrol tanpa full builder.
2. Text/fallback/handoff bisa dipublish dan rollback.

### Phase F: Test Suite

Estimasi: 5-7 hari.

Task:

1. Tambahkan `BotTestCase`.
2. Tambahkan `BotTestRun`.
3. Tambahkan `BotTestResult`.
4. Update Test Lab.
5. Tambahkan save as test case.
6. Tambahkan run suite.
7. Integrasikan dengan Release API.

Output:

1. Publish punya regression gate.
2. Perubahan bot bisa diuji sebelum live.

### Phase G: Decision Triage

Estimasi: 4-6 hari.

Task:

1. Tambahkan `BotDecisionTriage`.
2. Update Decision Logs UI.
3. Tambahkan assign/resolved.
4. Tambahkan create knowledge draft dari decision.
5. Tambahkan create test case dari decision.
6. Tambahkan tests.

Output:

1. Log tidak hanya dibaca, tetapi bisa ditindaklanjuti.

### Phase H: Channel Policy Management

Estimasi: 5-7 hari.

Task:

1. Tambahkan `ChannelPolicySetting`.
2. Buat Channel Policy UI.
3. Integrasikan safety config ke safety guard.
4. Integrasikan capability rules ke channel router.
5. Tambahkan warnings untuk Official default.
6. Tambahkan tests.

Output:

1. Strategi Official/Unofficial bisa dikontrol.
2. WhatsApp Unofficial tetap optimal tetapi aman.

---

## 16. Test Plan

Unit tests:

1. Runtime rule loader.
2. Rule draft validation.
3. Knowledge revision lifecycle.
4. Flow safe config validation.
5. Release snapshot creation.
6. Rollback pointer restore.
7. Safety guard duplicate exclusion.
8. Stuck job recovery.
9. Permission checks.

API tests:

1. Unauthorized request returns 401.
2. Forbidden role returns 403.
3. Invalid body returns 400.
4. Draft creation writes audit log.
5. Publish requires approved entities.
6. Publish requires passed test run.
7. Rollback creates new release.

Integration tests:

1. Create knowledge draft -> approve -> test -> publish -> bot can use.
2. Edit flow fallback -> test -> publish -> simulator uses new fallback.
3. Change channel policy -> publish -> router respects setting.
4. Failed pre-release test blocks publish.
5. Rollback restores previous behavior.

Manual QA:

1. Operator can create FAQ without developer help.
2. Admin can see before/after diff.
3. Agent can save real failed answer as test case.
4. Bot Manager can run pre-release suite.
5. Owner can rollback release.

---

## 17. Security Requirements

1. Semua mutation wajib auth.
2. Semua mutation wajib role check.
3. Audit log tidak boleh bisa diedit.
4. Trace harus tetap disanitasi sebelum disimpan.
5. Knowledge editor harus sanitize HTML jika rich text dipakai.
6. Jangan simpan API key/provider token di release snapshot.
7. Jangan tampilkan secret di before/after diff.
8. Rollback tidak boleh menghapus data.
9. Official/Unofficial provider config hanya boleh diedit owner/admin.
10. Campaign safety tidak boleh bisa dimatikan tanpa owner override.

---

## 18. Performance Requirements

1. Rules loader harus cache pendek, misalnya 30-60 detik.
2. Knowledge search harus pakai pagination.
3. Decision logs harus pakai index `startedAt`, `status`, dan `messageId`.
4. Audit logs harus pagination.
5. Test suite harus berjalan batch, bukan satu request terlalu lama.
6. Outbound queue list harus filter by status dan date.
7. Release snapshot jangan menyimpan payload terlalu besar.
8. Knowledge chunks jangan dikirim semua ke UI tanpa limit.

---

## 19. Documentation Automation

Setiap publish harus menghasilkan dokumentasi otomatis:

1. Active rules.
2. Active knowledge sources.
3. Active flows.
4. Channel policy.
5. Release notes.
6. Test summary.
7. Rollback target.

Endpoint existing `export-docs` bisa diperluas.

Format export:

1. Markdown untuk internal developer.
2. JSON snapshot untuk audit.
3. Optional PDF di fase berikutnya.

---

## 20. Definition of Done

Fase Manage Second dianggap selesai jika:

1. Rule editable bisa draft/review/approve/publish/rollback.
2. Knowledge bisa draft/review/approve/publish/rollback.
3. Flow safe config bisa draft/review/approve/publish/rollback.
4. Test case bisa disimpan dan test run bisa dijalankan.
5. Release publish membutuhkan test result.
6. Rollback bisa dilakukan dari UI.
7. Audit log mencatat semua mutation.
8. Decision log punya triage workflow.
9. Outbound queue punya dashboard dan stuck recovery.
10. Channel policy bisa dikelola.
11. Semua perubahan covered by tests.
12. `npm test`, `npx tsc --noEmit`, lint, dan build lulus.

---

## 21. Developer Execution Checklist

Checklist implementasi:

1. Buat migration model baru.
2. Generate Prisma client.
3. Tambahkan audit helper.
4. Tambahkan release snapshot helper.
5. Tambahkan permission helper.
6. Tambahkan rule setting seed.
7. Tambahkan rules draft API.
8. Tambahkan knowledge revision API.
9. Tambahkan flow version API.
10. Tambahkan test case API.
11. Tambahkan release API.
12. Tambahkan rollback API.
13. Tambahkan decision triage API.
14. Tambahkan outbound queue API.
15. Tambahkan channel policy API.
16. Update Rules UI.
17. Update Knowledge UI.
18. Update Flows UI.
19. Update Test Lab UI.
20. Update Decision Logs UI.
21. Tambahkan Outbound Queue UI.
22. Tambahkan Channel Policy UI.
23. Tambahkan Releases UI.
24. Tambahkan Audit Logs UI.
25. Integrasikan runtime loaders.
26. Tambahkan tests.
27. Jalankan full verification.
28. Export documentation.

---

## 22. Recommended Order for Pull Requests

PR 1: Stabilization and outbound safety

1. Fix lint.
2. Fix duplicate guard.
3. Add stuck recovery.
4. Add outbound jobs list.

PR 2: Audit and release foundation

1. Add audit log.
2. Add release model.
3. Add release APIs.
4. Add release UI.

PR 3: Rule management

1. Add rule settings.
2. Add runtime loader.
3. Add rules UI management.

PR 4: Knowledge management

1. Add revisions.
2. Add editor.
3. Add managed knowledge runtime.

PR 5: Flow safe config

1. Add flow definitions and versions.
2. Add safe config editor.
3. Integrate runtime config.

PR 6: Test suite

1. Add test cases.
2. Add test runs.
3. Gate release publish.

PR 7: Decision triage

1. Add triage.
2. Add actions from decision logs.

PR 8: Channel policy

1. Add channel policy settings.
2. Integrate router/safety guard.
3. Add UI.

---

## 23. Notes for Future Extend Third

Setelah fase ini selesai, baru lanjut ke:

1. Flow Builder V1.
2. Automation Engine.
3. Campaign WhatsApp V1.
4. AI Objective.
5. CRM lifecycle automation.
6. Inbox AI Assist.
7. WhatsApp interactive fallback layer.
8. Omnichannel channels.

Syarat sebelum Extend Third:

1. Release system sudah stabil.
2. Rollback sudah terbukti.
3. Test suite sudah dipakai sebelum publish.
4. Knowledge management sudah dipakai tim.
5. Channel policy sudah jelas.

---

## 24. Final Product Shape

Setelah fase Manage Second selesai, `wa-inbox` akan memiliki:

1. Bot yang bisa dilihat.
2. Bot yang bisa dikontrol.
3. Bot yang bisa dites.
4. Bot yang bisa dipublish dengan aman.
5. Bot yang bisa diaudit.
6. Bot yang bisa di-rollback.
7. Knowledge yang bisa dikelola tanpa deploy.
8. Rule yang bisa diubah tanpa mengedit kode untuk area yang aman.
9. Flow existing yang bisa dikelola secara terbatas.
10. Outbound WhatsApp Unofficial yang lebih aman untuk penggunaan real.

Ini adalah fondasi yang harus ada sebelum membangun flow builder, campaign besar, dan automation yang lebih agresif.

