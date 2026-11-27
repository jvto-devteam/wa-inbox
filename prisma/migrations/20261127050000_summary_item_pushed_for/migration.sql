-- AlterTable
ALTER TABLE "SummaryItem" ADD COLUMN     "pushedFor" TIMESTAMP(3);

-- Item yang sudah terbuka saat fitur tayang dianggap sudah dikabarkan: tanpa ini tick pertama mengirim push
-- untuk seluruh antrean lama sekaligus.
UPDATE "SummaryItem" SET "pushedFor" = "anchorAt" WHERE "state" = 'OPEN';
