-- Template sistem (pesan yang dikirim program lain lewat POST /api/v1/system-messages).
-- Aditif murni kecuali satu pelonggaran: OutboundJob.conversationId DROP NOT NULL
-- (job ke grup / nomor internal tidak punya percakapan). Tidak ada DROP / TRUNCATE.

-- CreateEnum
CREATE TYPE "SystemTemplateAudience" AS ENUM ('CUSTOMER', 'INTERNAL');

-- AlterTable
ALTER TABLE "OutboundJob" ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "sourceClientId" TEXT,
ADD COLUMN     "target" TEXT,
ADD COLUMN     "templateKey" TEXT,
ALTER COLUMN "conversationId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "SystemTemplate" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "audience" "SystemTemplateAudience" NOT NULL,
    "body" TEXT NOT NULL,
    "imageUrl" TEXT,
    "variables" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiClient" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiClient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SystemTemplate_key_key" ON "SystemTemplate"("key");

-- CreateIndex
CREATE UNIQUE INDEX "ApiClient_keyHash_key" ON "ApiClient"("keyHash");

-- CreateIndex
CREATE UNIQUE INDEX "OutboundJob_idempotencyKey_key" ON "OutboundJob"("idempotencyKey");

