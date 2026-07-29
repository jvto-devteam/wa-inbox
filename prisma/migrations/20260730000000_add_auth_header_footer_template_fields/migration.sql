-- AlterEnum
ALTER TYPE "TemplateFormat" ADD VALUE 'AUTH';

-- AlterTable
ALTER TABLE "Template" ADD COLUMN     "header" JSONB,
ADD COLUMN     "footer" TEXT;
