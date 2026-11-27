-- CreateTable
CREATE TABLE "CallEscalation" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "triggerKey" TEXT NOT NULL,
    "itemId" TEXT,
    "anchorAt" TIMESTAMP(3),
    "label" TEXT,
    "armedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'ARMED',
    "jobId" TEXT,
    "outcome" TEXT,
    "detail" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CallEscalation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CallEscalation_triggerKey_key" ON "CallEscalation"("triggerKey");

-- CreateIndex
CREATE INDEX "CallEscalation_status_armedAt_idx" ON "CallEscalation"("status", "armedAt");

