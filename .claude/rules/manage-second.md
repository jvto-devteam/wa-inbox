---
paths:
  - "src/lib/bot-control/**"
  - "src/app/api/bot-control/**"
  - "prisma/schema.prisma"
---
# Manage Second Rules

## Audit Log
- Setiap mutation (create/update/publish/rollback) wajib menulis `BotControlAuditLog`.
- Audit log tidak boleh diedit dari UI.
- Before/after diff hanya untuk field yang berubah, jangan tampilkan secret.

## Rule Management
- `BotRuleSetting` di-seed dari `src/lib/bot-control/rule-registry.ts`.
- Rule dengan `editable: false` tidak boleh memiliki draft/update API.
- Rule dengan `editable: true` hanya bisa diubah melalui draft → review → approve → publish.

## Knowledge Management
- `KnowledgeRevision` adalah sumber kebenaran untuk managed knowledge.
- Catalog index (`KnowledgeSource` dari `catalog/*.json`) tetap berjalan paralel.
- Bot trace harus mencatat `knowledgeRefs` dengan source type (`CATALOG` atau `MANAGED`).

## Flow Safe Config
- Hanya field yang terdaftar di SDD section 8.3 yang boleh diedit di fase ini.
- Branching logic kompleks tetap read-only sampai Flow Builder V1.

## Test Suite
- Test case harus disimpan dengan `expectedStatus`, `expectedContains`, dll.
- Test run `status = PASSED` adalah syarat publish, kecuali override oleh Owner.

## Release
- Publish transaction: update active versions + create release + update status + write audit.
- Rollback transaction: create new release + restore pointers + write audit.
- `BotRelease.snapshot` tidak boleh mengandung secret/API key.

## Outbound
- Stuck job recovery: `SENDING` > 5 menit → `RETRYING` atau `FAILED`.
- Duplicate check harus exclude `messageId` sendiri.
- Campaign job harus memeriksa `ContactConsent.optOut`.
