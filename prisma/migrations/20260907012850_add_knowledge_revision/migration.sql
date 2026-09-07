-- AlterTable
ALTER TABLE "KnowledgeSource" ADD COLUMN     "createdBy" TEXT,
ADD COLUMN     "ownerId" TEXT;

-- CreateTable
CREATE TABLE "KnowledgeRevision" (
    "id" TEXT NOT NULL,
    "knowledgeSourceId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "body" JSONB NOT NULL,
    "summary" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "changeReason" TEXT,
    "createdBy" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "publishedBy" TEXT,
    "publishedAt" TIMESTAMP(3),
    "releaseId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KnowledgeRevision_knowledgeSourceId_idx" ON "KnowledgeRevision"("knowledgeSourceId");

-- CreateIndex
CREATE INDEX "KnowledgeRevision_status_idx" ON "KnowledgeRevision"("status");

-- CreateIndex
CREATE INDEX "KnowledgeRevision_releaseId_idx" ON "KnowledgeRevision"("releaseId");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeRevision_knowledgeSourceId_version_key" ON "KnowledgeRevision"("knowledgeSourceId", "version");

-- CreateIndex
CREATE INDEX "KnowledgeSource_ownerId_idx" ON "KnowledgeSource"("ownerId");

-- AddForeignKey
ALTER TABLE "KnowledgeRevision" ADD CONSTRAINT "KnowledgeRevision_knowledgeSourceId_fkey" FOREIGN KEY ("knowledgeSourceId") REFERENCES "KnowledgeSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

