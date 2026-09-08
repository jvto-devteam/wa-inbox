-- Right-sizing Bot Control, bagian 2 dari 2: DESTRUKTIF. TIDAK BISA DIBALIK.
--
-- JANGAN jalankan sebelum:
--   (a) migrasi aditif (bagian 1) sudah diterapkan,
--   (b) langkah pemindahan data sudah dijalankan dan diverifikasi,
--   (c) kode baru sudah ter-deploy,
--   (d) `pg_dump` atas tabel yang di-DROP sudah diambil.
--
-- Yang hilang permanen di sini: BotRelease.snapshot (satu-satunya salinan konfigurasi
-- lama), BotControlAuditLog.before/after, dan seluruh isi 10 tabel di bawah.

-- DropForeignKey
ALTER TABLE "KnowledgeChunk" DROP CONSTRAINT "KnowledgeChunk_knowledgeSourceId_fkey";

-- DropForeignKey
ALTER TABLE "BotFlowVersion" DROP CONSTRAINT "BotFlowVersion_flowId_fkey";

-- DropForeignKey
ALTER TABLE "BotTestResult" DROP CONSTRAINT "BotTestResult_testRunId_fkey";

-- DropIndex
DROP INDEX "KnowledgeRevision_releaseId_idx";

-- DropIndex
DROP INDEX "BotControlAuditLog_entityKey_idx";

-- DropIndex
DROP INDEX "BotControlAuditLog_releaseId_idx";

-- AlterTable
ALTER TABLE "KnowledgeSource" DROP COLUMN "lastSyncedAt",
DROP COLUMN "metadata",
DROP COLUMN "sourcePath";

-- AlterTable
ALTER TABLE "KnowledgeRevision" DROP COLUMN "releaseId",
DROP COLUMN "reviewedAt",
DROP COLUMN "reviewedBy";

-- AlterTable
ALTER TABLE "BotControlAuditLog" DROP COLUMN "after",
DROP COLUMN "before",
DROP COLUMN "ipAddress",
DROP COLUMN "releaseId",
DROP COLUMN "userAgent";

-- DropTable
DROP TABLE "KnowledgeChunk";

-- DropTable
DROP TABLE "BotRelease";

-- DropTable
DROP TABLE "BotRuleSetting";

-- DropTable
DROP TABLE "BotFlowDefinition";

-- DropTable
DROP TABLE "BotFlowVersion";

-- DropTable
DROP TABLE "BotTestCase";

-- DropTable
DROP TABLE "BotTestRun";

-- DropTable
DROP TABLE "BotTestResult";

-- DropTable
DROP TABLE "BotDecisionTriage";

-- DropTable
DROP TABLE "ChannelPolicySetting";
