◇ injected env (21) from .env // tip: ◈ encrypted .env [www.dotenvx.com]
-- CreateTable
CREATE TABLE "BookingFact" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "bookingId" TEXT,
    "field" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "sourceMessageId" TEXT,
    "statedAt" TIMESTAMP(3) NOT NULL,
    "supersededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookingFact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookingAction" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "bookingId" TEXT,
    "type" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "proposedValue" JSONB,
    "draftText" TEXT,
    "state" TEXT NOT NULL,
    "closedReason" TEXT,
    "sourceMessageId" TEXT,
    "forDay" TEXT,
    "lastError" TEXT,
    "closedById" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BookingAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookingActionEvent" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "bookingId" TEXT,
    "actionId" TEXT,
    "event" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "accountId" TEXT,
    "oldValue" JSONB,
    "newValue" JSONB,
    "sourceMessageId" TEXT,
    "reason" TEXT,
    "backoffice" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookingActionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BookingFact_conversationId_field_idx" ON "BookingFact"("conversationId", "field");

-- CreateIndex
CREATE INDEX "BookingAction_conversationId_state_idx" ON "BookingAction"("conversationId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "BookingAction_bookingId_type_forDay_key" ON "BookingAction"("bookingId", "type", "forDay");

-- CreateIndex
CREATE INDEX "BookingActionEvent_bookingId_createdAt_idx" ON "BookingActionEvent"("bookingId", "createdAt");

-- CreateIndex
CREATE INDEX "BookingActionEvent_conversationId_createdAt_idx" ON "BookingActionEvent"("conversationId", "createdAt");

-- AddForeignKey
ALTER TABLE "BookingFact" ADD CONSTRAINT "BookingFact_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingAction" ADD CONSTRAINT "BookingAction_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

