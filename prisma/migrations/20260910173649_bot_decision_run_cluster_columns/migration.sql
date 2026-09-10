-- AlterTable
ALTER TABLE "BotDecisionRun" ADD COLUMN     "job" TEXT,
ADD COLUMN     "topic" TEXT;

-- CreateIndex
CREATE INDEX "BotDecisionRun_topic_idx" ON "BotDecisionRun"("topic");

