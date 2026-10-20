-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "bookingBaliApproval" TEXT NOT NULL DEFAULT 'ALWAYS',
ADD COLUMN     "bookingLightApproval" TEXT NOT NULL DEFAULT 'ALWAYS',
ADD COLUMN     "dataRequestApproval" TEXT NOT NULL DEFAULT 'ALWAYS';

