-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AccountRole" ADD VALUE 'OWNER';
ALTER TYPE "AccountRole" ADD VALUE 'BOT_MANAGER';

-- CreateTable
CREATE TABLE "ChannelPolicySetting" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "defaultOutbound" TEXT NOT NULL DEFAULT 'UNOFFICIAL',
    "officialMode" TEXT NOT NULL DEFAULT 'INBOUND_AND_CAPABILITY',
    "unofficialMode" TEXT NOT NULL DEFAULT 'PRIMARY_OUTBOUND',
    "capabilityRules" JSONB NOT NULL,
    "safetyConfig" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PUBLISHED',
    "draftConfig" JSONB,
    "draftUpdatedBy" TEXT,
    "draftUpdatedAt" TIMESTAMP(3),
    "publishedBy" TEXT,
    "publishedAt" TIMESTAMP(3),
    "releaseId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelPolicySetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChannelPolicySetting_key_key" ON "ChannelPolicySetting"("key");

-- CreateIndex
CREATE INDEX "ChannelPolicySetting_status_idx" ON "ChannelPolicySetting"("status");

