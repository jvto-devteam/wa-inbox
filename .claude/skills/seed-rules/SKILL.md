---
description: Seed BotRuleSetting dari static rule-registry.ts ke database.
---
# Seed Rules Skill

Langkah:
1. Baca `src/lib/bot-control/rule-registry.ts` untuk mendapatkan daftar rule statis.
2. Untuk setiap rule, buat atau update `BotRuleSetting` di database dengan:
   - `key`, `name`, `category`, `description`, `severity`, `editable`, `enabled`, `config`.
   - `status = PUBLISHED` (karena ini adalah baseline).
3. Jangan overwrite config yang sudah ada jika rule sudah di-customize.
4. Laporkan jumlah rule yang di-seed/update.
