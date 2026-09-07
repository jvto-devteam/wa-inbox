-- CreateTable
CREATE TABLE "BotRuleSetting" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "editable" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB,
    "runtimeSource" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PUBLISHED',
    "draftConfig" JSONB,
    "draftEnabled" BOOLEAN,
    "draftUpdatedBy" TEXT,
    "draftUpdatedAt" TIMESTAMP(3),
    "publishedBy" TEXT,
    "publishedAt" TIMESTAMP(3),
    "releaseId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BotRuleSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BotRuleSetting_key_key" ON "BotRuleSetting"("key");

-- CreateIndex
CREATE INDEX "BotRuleSetting_category_idx" ON "BotRuleSetting"("category");

-- CreateIndex
CREATE INDEX "BotRuleSetting_severity_idx" ON "BotRuleSetting"("severity");

-- CreateIndex
CREATE INDEX "BotRuleSetting_status_idx" ON "BotRuleSetting"("status");

