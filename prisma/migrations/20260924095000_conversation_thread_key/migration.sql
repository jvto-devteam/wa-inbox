-- CreateIndex
CREATE UNIQUE INDEX "Conversation_channelIdentityId_externalThreadId_key" ON "Conversation"("channelIdentityId", "externalThreadId");

