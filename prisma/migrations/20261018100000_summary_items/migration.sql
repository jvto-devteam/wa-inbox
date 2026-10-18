-- CreateTable
CREATE TABLE "SummaryItem" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "anchorAt" TIMESTAMP(3) NOT NULL,
    "anchorMessageId" TEXT,
    "snippet" TEXT NOT NULL,
    "review" JSONB,
    "handoff" BOOLEAN NOT NULL DEFAULT false,
    "newLead" BOOLEAN NOT NULL DEFAULT false,
    "openedOn" TEXT NOT NULL,
    "lastSeenOn" TEXT NOT NULL,
    "reminderId" TEXT,
    "dueAt" TIMESTAMP(3),
    "closedReason" TEXT,
    "note" TEXT,
    "closedById" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SummaryItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SummaryItem_conversationId_key" ON "SummaryItem"("conversationId");

-- CreateIndex
CREATE INDEX "SummaryItem_state_idx" ON "SummaryItem"("state");

-- AddForeignKey
ALTER TABLE "SummaryItem" ADD CONSTRAINT "SummaryItem_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

