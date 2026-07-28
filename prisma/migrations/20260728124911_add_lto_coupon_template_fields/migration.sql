-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TemplateFormat" ADD VALUE 'LTO';
ALTER TYPE "TemplateFormat" ADD VALUE 'COUPON';

-- AlterTable
ALTER TABLE "Template" ADD COLUMN     "buttons" JSONB,
ADD COLUMN     "couponButtonText" TEXT,
ADD COLUMN     "couponExampleCode" TEXT,
ADD COLUMN     "offerTitle" TEXT;
