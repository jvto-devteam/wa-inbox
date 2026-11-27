-- AlterTable
ALTER TABLE "ChannelIdentity" ADD COLUMN     "bsuid" TEXT;

-- CreateTable
CREATE TABLE "WebhookFailure" (
    "id" TEXT NOT NULL,
    "bodyHash" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "error" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAttemptAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "WebhookFailure_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WebhookFailure_bodyHash_key" ON "WebhookFailure"("bodyHash");

-- CreateIndex
CREATE INDEX "WebhookFailure_processedAt_createdAt_idx" ON "WebhookFailure"("processedAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelIdentity_platform_bsuid_key" ON "ChannelIdentity"("platform", "bsuid");

