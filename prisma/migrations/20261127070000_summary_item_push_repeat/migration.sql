-- AlterTable
ALTER TABLE "SummaryItem" ADD COLUMN     "pushCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "pushedAt" TIMESTAMP(3);

