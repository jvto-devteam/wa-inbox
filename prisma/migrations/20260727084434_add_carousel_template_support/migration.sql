-- CreateEnum
CREATE TYPE "TemplateFormat" AS ENUM ('TEXT', 'CAROUSEL');

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "templatePayload" JSONB;

-- AlterTable
ALTER TABLE "Template" ADD COLUMN     "cards" JSONB,
ADD COLUMN     "format" "TemplateFormat" NOT NULL DEFAULT 'TEXT';
