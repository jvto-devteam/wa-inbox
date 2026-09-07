---
description: Seed BotRuleSetting dari static rule-registry.ts ke database.
---
# Seed Rules Skill

Langkah:
1. Jalankan `npm run seed:rules` (implementasinya di `src/lib/bot-control/rule-seed.ts`).
2. Laporkan jumlah rule yang dibuat, disinkronkan, dan tidak berubah.

Yang perlu diketahui sebelum menjalankan:

- Metadata dari registry (`name`, `category`, `description`, `severity`, `editable`) SELALU
  ditulis ulang. `editable` khususnya harus ditegaskan ulang setiap kali: nilai `true` yang
  basi di database akan membuat rule yang sudah dikunci kode terlihat bisa diubah dari UI.
- `config` dan `enabled` HANYA ditulis saat baris pertama kali dibuat. Menjalankan ulang tidak
  boleh mengembalikan perubahan yang sudah dipublish operator ke default kode — itu akan
  menjadikan seed rutin sebagai rollback diam-diam tanpa penanggung jawab.
- Setiap baris yang dibuat atau disinkronkan menulis audit log dengan actor `system`.
