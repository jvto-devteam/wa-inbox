-- DropIndex
DROP INDEX "Contact_phone_key";

-- DropIndex
DROP INDEX "Conversation_contactId_key";

-- AlterTable
ALTER TABLE "Contact" ALTER COLUMN "phone" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "Conversation_contactId_idx" ON "Conversation"("contactId");

