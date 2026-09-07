-- CreateTable
CREATE TABLE "BotControlAuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "entityKey" TEXT,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "releaseId" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BotControlAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BotRelease" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PUBLISHED',
    "publishedBy" TEXT,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rollbackOfId" TEXT,
    "testRunId" TEXT,
    "snapshot" JSONB NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BotRelease_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BotControlAuditLog_entityType_entityId_idx" ON "BotControlAuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "BotControlAuditLog_entityKey_idx" ON "BotControlAuditLog"("entityKey");

-- CreateIndex
CREATE INDEX "BotControlAuditLog_action_idx" ON "BotControlAuditLog"("action");

-- CreateIndex
CREATE INDEX "BotControlAuditLog_releaseId_idx" ON "BotControlAuditLog"("releaseId");

-- CreateIndex
CREATE INDEX "BotControlAuditLog_createdAt_idx" ON "BotControlAuditLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BotRelease_version_key" ON "BotRelease"("version");

-- CreateIndex
CREATE INDEX "BotRelease_status_idx" ON "BotRelease"("status");

-- CreateIndex
CREATE INDEX "BotRelease_publishedAt_idx" ON "BotRelease"("publishedAt");

