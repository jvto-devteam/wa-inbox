-- CreateTable
CREATE TABLE "BotFlowDefinition" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "runtimeSource" TEXT,
    "editableLevel" TEXT NOT NULL DEFAULT 'READ_ONLY',
    "activeVersionId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PUBLISHED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BotFlowDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BotFlowVersion" (
    "id" TEXT NOT NULL,
    "flowId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "triggerConfig" JSONB,
    "nodeConfig" JSONB NOT NULL,
    "edgeConfig" JSONB,
    "fallbackConfig" JSONB,
    "handoffConfig" JSONB,
    "changeReason" TEXT,
    "createdBy" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "publishedBy" TEXT,
    "publishedAt" TIMESTAMP(3),
    "releaseId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BotFlowVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BotFlowDefinition_key_key" ON "BotFlowDefinition"("key");

-- CreateIndex
CREATE INDEX "BotFlowDefinition_category_idx" ON "BotFlowDefinition"("category");

-- CreateIndex
CREATE INDEX "BotFlowDefinition_status_idx" ON "BotFlowDefinition"("status");

-- CreateIndex
CREATE INDEX "BotFlowVersion_flowId_idx" ON "BotFlowVersion"("flowId");

-- CreateIndex
CREATE INDEX "BotFlowVersion_status_idx" ON "BotFlowVersion"("status");

-- CreateIndex
CREATE INDEX "BotFlowVersion_releaseId_idx" ON "BotFlowVersion"("releaseId");

-- CreateIndex
CREATE UNIQUE INDEX "BotFlowVersion_flowId_version_key" ON "BotFlowVersion"("flowId", "version");

-- AddForeignKey
ALTER TABLE "BotFlowVersion" ADD CONSTRAINT "BotFlowVersion_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "BotFlowDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

