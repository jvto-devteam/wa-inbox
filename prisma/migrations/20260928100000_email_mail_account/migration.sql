-- Fase email (docs/superpowers/plans/2026-09-28-omnichannel-email.md, Tugas 1). Aditif murni.

CREATE TABLE "MailAccount" (
    "id" TEXT NOT NULL,
    "emailAddress" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "historyId" TEXT,
    "watchExpiresAt" TIMESTAMP(3),
    "lastSyncAt" TIMESTAMP(3),
    "lastSyncError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MailAccount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MailAccount_emailAddress_key" ON "MailAccount"("emailAddress");

ALTER TABLE "Conversation" ADD COLUMN "mailAccountId" TEXT;
ALTER TABLE "Conversation" ADD COLUMN "subject" TEXT;

CREATE UNIQUE INDEX "Conversation_mailAccountId_externalThreadId_key" ON "Conversation"("mailAccountId", "externalThreadId");

ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_mailAccountId_fkey" FOREIGN KEY ("mailAccountId") REFERENCES "MailAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Keputusan D1: bot tidak pernah menjawab email. Sakelar Email dilepas dari UI di Tugas 10;
-- nilai yang mungkin sempat dinyalakan lewat sakelar lama dinolkan sekali di sini supaya
-- POST /api/bot/mode (yang membaca sakelar per platform) tidak pernah menyalakan botEnabled
-- untuk percakapan email. Idempoten.
UPDATE "Settings" SET "botEnabledEmail" = false;
