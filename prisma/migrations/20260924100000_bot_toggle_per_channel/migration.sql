-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "botEnabledEmail" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "botEnabledFacebook" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "botEnabledInstagram" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "botEnabledWhatsapp" BOOLEAN NOT NULL DEFAULT true;
