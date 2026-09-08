-- Kanvas pipeline live, bagian B: jejak langkah per run.
--
-- ADITIF SAJA -- satu kolom nullable, tanpa DROP, tanpa backfill, tanpa index. Baris lama
-- tetap valid dengan `steps` NULL (artinya: run itu berjalan sebelum instrumentasi ada).
--
-- Timestamp 20260908130000 dipilih supaya migrasi ini berurutan SETELAH
-- 20260908120000_right_size_bot_control_destructive, yang belum diterapkan ke produksi.
-- Menaruhnya lebih awal akan membuat `migrate deploy` menjalankan yang destruktif setelah
-- yang ini, bukan sebelumnya, dan memutus urutan yang sudah disepakati di migrasi 110000.

-- AlterTable
ALTER TABLE "BotDecisionRun" ADD COLUMN     "steps" JSONB;
