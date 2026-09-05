---
description: Menjalankan indexCatalogKnowledge untuk mensinkronkan semua catalog JSON ke database KnowledgeSource/KnowledgeChunk.
---
# Sync Knowledge Skill

Langkah:
1. Buka file `src/lib/bot-control/knowledge-indexer.ts`.
2. Jalankan fungsi `indexCatalogKnowledge()` melalui script atau panggil via API jika tersedia.
3. Laporkan jumlah sources dan chunks yang berhasil diindex.
4. Catat waktu terakhir sync di `KnowledgeSource.lastSyncedAt`.
