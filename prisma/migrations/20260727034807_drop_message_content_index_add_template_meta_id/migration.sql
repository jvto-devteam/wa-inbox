-- DropIndex
DROP INDEX "Message_content_idx";

-- AlterTable
ALTER TABLE "Template" ADD COLUMN     "metaId" TEXT;
