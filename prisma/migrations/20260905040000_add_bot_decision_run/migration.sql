-- CreateTable
CREATE TABLE "BotDecisionRun" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "messageId" TEXT,
    "mode" TEXT NOT NULL,
    "inboundText" TEXT NOT NULL,
    "replyText" TEXT,
    "status" TEXT NOT NULL,
    "flowKey" TEXT,
    "flowVersion" INTEGER,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "latencyMs" INTEGER,
    "trace" JSONB NOT NULL,
    "knowledgeRefs" JSONB,
    "verification" JSONB,
    "error" TEXT,

    CONSTRAINT "BotDecisionRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BotDecisionRun_conversationId_idx" ON "BotDecisionRun"("conversationId");

-- CreateIndex
CREATE INDEX "BotDecisionRun_startedAt_idx" ON "BotDecisionRun"("startedAt");

-- CreateIndex
CREATE INDEX "BotDecisionRun_status_idx" ON "BotDecisionRun"("status");

-- CreateIndex
CREATE INDEX "BotDecisionRun_messageId_idx" ON "BotDecisionRun"("messageId");
