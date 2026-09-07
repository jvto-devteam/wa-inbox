# wa-inbox — Project Rules (WAJIB) — Fase Manage Second

Dokumen ini adalah **konstitusi pengembangan** untuk fase **Manage Second**.  
Referensi lengkap: `.claude/docs/bot-control-manage-second-spec.md` (SDD Manage Second).

---

## Stack Teknologi
- Next.js 16 App Router, React 19, TypeScript, Prisma 7, PostgreSQL, Tailwind v4, Vitest.

## Prinsip Eksekusi Fase Ini
1. **Semua perubahan = draft → review → approve → test → publish → rollback.**
2. **Jangan langsung mengubah runtime.** Setiap perubahan harus melalui release.
3. **Setiap publish wajib memiliki snapshot dan audit log.**
4. **Test suite adalah gate untuk publish.**
5. **Rollback harus semudah publish.**

## Urutan Pengerjaan (WAJIB, tidak boleh dilompati)
1. **Phase A: Stabilization** (3-5 hari) — fix lint, duplicate guard, stuck recovery, outbound jobs list.
2. **Phase B: Audit and Release Foundation** (5-7 hari) — audit log, release model, release API, release UI.
3. **Phase C: Rule Management** (5-7 hari) — BotRuleSetting, runtime loader, rules UI.
4. **Phase D: Knowledge Management** (7-10 hari) — KnowledgeRevision, editor, managed knowledge loader.
5. **Phase E: Flow Safe Config** (7-10 hari) — BotFlowDefinition/Version, safe config editor, runtime config.
6. **Phase F: Test Suite** (5-7 hari) — BotTestCase, BotTestRun, Test Lab upgrade.
7. **Phase G: Decision Triage** (4-6 hari) — BotDecisionTriage, decision logs actions.
8. **Phase H: Channel Policy Management** (5-7 hari) — ChannelPolicySetting, router/safety guard integration, UI.

**Definition of Done per phase** ada di SDD section 15.

## Aturan Khusus Manage Second

### Model Data Baru (Wajib)
Semua model baru di SDD section 7 harus dibuat di `prisma/schema.prisma`:
- `BotControlAuditLog`
- `BotRelease`
- `BotRuleSetting`
- `KnowledgeRevision` (gunakan model terpisah, jangan extend `KnowledgeSource`)
- `BotFlowDefinition`
- `BotFlowVersion`
- `BotTestCase`
- `BotTestRun`
- `BotTestResult`
- `BotDecisionTriage`
- `ChannelPolicySetting`

**Larangan:** Jangan menambahkan field di luar SDD tanpa diskusi.

### API Design (Wajib)
- Semua mutation wajib:
  1. Auth (getSession)
  2. Role check (sesuai permission matrix SDD section 13)
  3. Validasi body (Zod)
  4. Audit log (`writeBotAuditLog`)
  5. Transaction untuk publish/rollback
- Response error selalu `{ error: string }` dengan status HTTP sesuai.
- Jangan bocorkan secret di response.

### Runtime Integration
- `src/lib/bot-control/runtime-rules.ts` — loader rule dari DB + fallback static.
- `src/lib/bot/managed-knowledge.ts` — hybrid catalog + managed knowledge.
- `src/lib/outbound/safety-guard.ts` — baca config dari `ChannelPolicySetting.safetyConfig`.
- `src/lib/outbound/worker.ts` — tambahkan `recoverStuckOutboundJobs()`.

### Publish & Rollback
- Publish harus dalam **satu transaksi Prisma**.
- `BotRelease.snapshot` harus menyimpan pointer active versions dan config (tanpa secret).
- Rollback membuat release baru dengan `rollbackOfId`, mengembalikan pointer ke snapshot target.

### Permission
- `BOT_MANAGER` adalah role baru. Tambahkan ke sistem auth.
- Owner boleh override failed test. Admin tidak boleh.

## Larangan Mutlak (Zero Tolerance)

Aturan ini dibawa dari fase Expose dan **tetap berlaku penuh** di fase Manage Second.
Tidak ada di SDD Manage Second yang mencabutnya.

- **Simulator** (`src/lib/bot-control/simulator.ts`) **DILARANG** memanggil `sendMessage` atau
  membuat `OutboundJob` — hanya dry-run.
- **Jangan pernah menampilkan token/API key** di UI, API response, atau dokumentasi export.
  Ini termasuk `BotRelease.snapshot` dan `BotControlAuditLog` before/after diff.
- **Jangan overwrite** `KnowledgeSource` yang `type=MANUAL`.
- **Dilarang** menggunakan `any`; gunakan `unknown` atau buat tipe yang sesuai.
- **Dilarang** menjalankan `npx prisma migrate dev` terhadap database produksi. Perintah itu
  bisa **me-reset database** saat mendeteksi drift, dan `DATABASE_URL` di repo ini menunjuk VPS
  produksi. Pakai `migrate diff` + `migrate deploy`, seperti seluruh fase A–H.

## Checklist Sebelum Commit per PR
1. `npm test`
2. `npx tsc --noEmit`
3. `npx eslint .` (0 error, warning boleh)
4. Jika ada perubahan skema Prisma:
   - **Development lokal:** `npx prisma migrate dev`.
   - **Production (VPS):** buat migrasi offline dengan
     `npx prisma migrate diff --from-schema <schema lama> --to-schema prisma/schema.prisma --script`,
     simpan ke `prisma/migrations/<timestamp>_<nama>/migration.sql`, lalu terapkan dengan
     `npx prisma migrate deploy`.
   - Periksa SQL-nya sebelum menerapkan: `DROP`, `TRUNCATE`, dan `ALTER TABLE` non-aditif harus
     didiskusikan lebih dulu.

## Referensi Final
- SDD Manage Second: `.claude/docs/bot-control-manage-second-spec.md`
- SDD Expose: `.claude/docs/bot-control-spec.md` (untuk konteks existing)
- Jika instruksi bertentangan, **yang berlaku adalah SDD Manage Second**.
