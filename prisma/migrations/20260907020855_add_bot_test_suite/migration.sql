-- CreateTable
CREATE TABLE "BotTestCase" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "inputText" TEXT NOT NULL,
    "conversationSeed" JSONB,
    "expectedStatus" TEXT,
    "expectedFlowKey" TEXT,
    "expectedContains" TEXT,
    "expectedNotContains" TEXT,
    "expectedHandoff" BOOLEAN,
    "requiredKnowledgeKeys" JSONB,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BotTestCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BotTestRun" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "scope" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "total" INTEGER NOT NULL DEFAULT 0,
    "passed" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "releaseId" TEXT,
    "startedBy" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "summary" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BotTestRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BotTestResult" (
    "id" TEXT NOT NULL,
    "testRunId" TEXT NOT NULL,
    "testCaseId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "inputText" TEXT NOT NULL,
    "actualStatus" TEXT,
    "actualFlowKey" TEXT,
    "actualReply" TEXT,
    "actualTrace" JSONB,
    "failureReason" TEXT,
    "latencyMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BotTestResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BotTestCase_category_idx" ON "BotTestCase"("category");

-- CreateIndex
CREATE INDEX "BotTestCase_enabled_idx" ON "BotTestCase"("enabled");

-- CreateIndex
CREATE INDEX "BotTestRun_scope_idx" ON "BotTestRun"("scope");

-- CreateIndex
CREATE INDEX "BotTestRun_status_idx" ON "BotTestRun"("status");

-- CreateIndex
CREATE INDEX "BotTestRun_releaseId_idx" ON "BotTestRun"("releaseId");

-- CreateIndex
CREATE INDEX "BotTestResult_testRunId_idx" ON "BotTestResult"("testRunId");

-- CreateIndex
CREATE INDEX "BotTestResult_testCaseId_idx" ON "BotTestResult"("testCaseId");

-- CreateIndex
CREATE INDEX "BotTestResult_status_idx" ON "BotTestResult"("status");

-- AddForeignKey
ALTER TABLE "BotTestResult" ADD CONSTRAINT "BotTestResult_testRunId_fkey" FOREIGN KEY ("testRunId") REFERENCES "BotTestRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

