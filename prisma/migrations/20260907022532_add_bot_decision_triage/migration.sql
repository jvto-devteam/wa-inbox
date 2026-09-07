-- CreateTable
CREATE TABLE "BotDecisionTriage" (
    "id" TEXT NOT NULL,
    "decisionRunId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "issueType" TEXT,
    "severity" TEXT NOT NULL DEFAULT 'NORMAL',
    "assignedTo" TEXT,
    "note" TEXT,
    "linkedEntityType" TEXT,
    "linkedEntityId" TEXT,
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BotDecisionTriage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BotDecisionTriage_decisionRunId_key" ON "BotDecisionTriage"("decisionRunId");

-- CreateIndex
CREATE INDEX "BotDecisionTriage_status_idx" ON "BotDecisionTriage"("status");

-- CreateIndex
CREATE INDEX "BotDecisionTriage_issueType_idx" ON "BotDecisionTriage"("issueType");

-- CreateIndex
CREATE INDEX "BotDecisionTriage_severity_idx" ON "BotDecisionTriage"("severity");

-- CreateIndex
CREATE INDEX "BotDecisionTriage_assignedTo_idx" ON "BotDecisionTriage"("assignedTo");

