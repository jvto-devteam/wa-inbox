-- CreateTable
CREATE TABLE "OutboundJob" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "messageId" TEXT,
    "channel" "MessageChannel" NOT NULL,
    "provider" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 4,
    "nextAttemptAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutboundJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactConsent" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "optIn" BOOLEAN NOT NULL DEFAULT true,
    "optOut" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT,
    "note" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContactConsent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OutboundJob_status_nextAttemptAt_idx" ON "OutboundJob"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "OutboundJob_conversationId_idx" ON "OutboundJob"("conversationId");

-- CreateIndex
CREATE INDEX "OutboundJob_messageId_idx" ON "OutboundJob"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "ContactConsent_contactId_key" ON "ContactConsent"("contactId");
