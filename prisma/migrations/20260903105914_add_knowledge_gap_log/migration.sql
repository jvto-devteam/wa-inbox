-- CreateTable
CREATE TABLE "KnowledgeGapLog" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "messageText" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeGapLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KnowledgeGapLog_createdAt_idx" ON "KnowledgeGapLog"("createdAt");

-- AddForeignKey
ALTER TABLE "KnowledgeGapLog" ADD CONSTRAINT "KnowledgeGapLog_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
