---
paths:
  - "prisma/schema.prisma"
---
# Prisma Schema Rules

- Semua model baru untuk Bot Control harus sesuai dengan SDD (BotFlowDefinition, BotRuleDefinition, KnowledgeSource, KnowledgeChunk, BotDecisionRun, OutboundJob, ContactConsent).
- Setelah mengubah schema, **wajib** membuat migrasi dan menguji di database development.
- Jangan menambahkan field yang tidak tercantum di SDD tanpa diskusi terlebih dahulu.
