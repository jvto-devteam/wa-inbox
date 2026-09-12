-- AlterTable
ALTER TABLE "KnowledgeGapLog" ADD COLUMN     "messageId" TEXT,
ADD COLUMN     "resolvedAt" TIMESTAMP(3),
ADD COLUMN     "runId" TEXT;

-- CreateIndex
CREATE INDEX "KnowledgeGapLog_resolvedAt_idx" ON "KnowledgeGapLog"("resolvedAt");

