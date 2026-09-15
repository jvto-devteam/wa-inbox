-- CreateTable
CREATE TABLE "MessageDraft" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "sourceMessageId" TEXT NOT NULL,
    "generatedText" TEXT,
    "text" TEXT,
    "decision" JSONB NOT NULL,
    "pendingKnowledgeGaps" JSONB,
    "decisionRunId" TEXT,
    "generatedById" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedById" TEXT,
    "editedAt" TIMESTAMP(3),
    "sentById" TEXT,
    "sentAt" TIMESTAMP(3),
    "sentMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessageDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MessageDraft_sourceMessageId_key" ON "MessageDraft"("sourceMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "MessageDraft_sentMessageId_key" ON "MessageDraft"("sentMessageId");

-- CreateIndex
CREATE INDEX "MessageDraft_conversationId_idx" ON "MessageDraft"("conversationId");

-- AddForeignKey
ALTER TABLE "MessageDraft" ADD CONSTRAINT "MessageDraft_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageDraft" ADD CONSTRAINT "MessageDraft_sourceMessageId_fkey" FOREIGN KEY ("sourceMessageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

