-- Right-sizing Bot Control, bagian 1 dari 2: ADITIF SAJA.
--
-- Migrasi ini hanya MENAMBAH kolom dan index. Aman dijalankan lebih dulu, dan aman
-- dibiarkan terpasang tanpa bagian 2.
--
-- URUTAN WAJIB:
--   1. `migrate deploy` (menerapkan migrasi ini)
--   2. jalankan langkah pemindahan data -- lihat scratchpad/*-data-migration-notes.sql
--   3. deploy kode baru
--   4. `migrate deploy` lagi (menerapkan bagian 2, yang destruktif)
--
-- Bagian 2 sengaja dipisah supaya langkah 2 tidak bisa terlewat: begitu tabel lama
-- di-DROP, nilainya tidak bisa dipindahkan lagi.

-- AlterTable
ALTER TABLE "BotDecisionRun" ADD COLUMN     "flagNote" TEXT,
ADD COLUMN     "flaggedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "campaignRatePerMinute" INTEGER NOT NULL DEFAULT 20,
ADD COLUMN     "duplicateWindowMs" INTEGER NOT NULL DEFAULT 60000,
ADD COLUMN     "fallbackReply" TEXT,
ADD COLUMN     "handoffOnHumanRequest" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "handoffReply" TEXT,
ADD COLUMN     "pausedProviders" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "providerFailureThreshold" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "providerFailureWindowMs" INTEGER NOT NULL DEFAULT 300000;

-- CreateIndex
CREATE INDEX "BotDecisionRun_flaggedAt_idx" ON "BotDecisionRun"("flaggedAt");
