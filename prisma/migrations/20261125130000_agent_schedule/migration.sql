-- CreateTable
CREATE TABLE "AgentSchedule" (
    "key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "bookingId" INTEGER NOT NULL,
    "bookingCode" TEXT,
    "bookingStatus" TEXT,
    "guestName" TEXT,
    "phoneTail" TEXT,
    "conversationId" TEXT,
    "recipient" TEXT NOT NULL,
    "sendAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "refreshedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentSchedule_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "AgentSchedule_sendAt_idx" ON "AgentSchedule"("sendAt");

