---
paths:
  - "prisma/schema.prisma"
---
# Prisma Schema Rules

- Model Bot Control yang benar-benar ada sekarang: `KnowledgeSource`, `KnowledgeRevision`,
  `BotDecisionRun`, `BotControlAuditLog`, `OutboundJob`, `ContactConsent`, dan kolom-kolom
  konfigurasi di `Settings`. Model dari fase Manage Second (`BotRelease`, `BotRuleSetting`,
  `BotFlowDefinition`, `BotFlowVersion`, `BotTestCase`, `BotTestRun`, `BotTestResult`,
  `BotDecisionTriage`, `ChannelPolicySetting`, `KnowledgeChunk`) **sudah dihapus dan tidak
  boleh dibuat ulang** — lihat `CLAUDE.md` section 3.
- `AccountRole` masih memuat `OWNER` dan `BOT_MANAGER`, tapi **tidak dipakai kode**: hanya
  `ADMIN` dan `AGENT` yang bisa diberikan. Jangan membangun logika baru di atas dua nilai itu.
- Konfigurasi baru yang dipilih operator **default-nya jadi kolom di `Settings`**, bukan
  tabel baru dengan siklus hidupnya sendiri.
- Setelah mengubah schema, **wajib** membuat migrasi dan mengujinya di database development.
  Untuk produksi ikuti `CLAUDE.md` section 7 (`migrate diff` + `migrate deploy`, **jangan**
  `migrate dev`).
- Jangan menambahkan field tanpa diskusi terlebih dahulu.
