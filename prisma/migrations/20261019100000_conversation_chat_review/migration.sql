-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "chatReview" JSONB,
ADD COLUMN     "chatReviewAt" TIMESTAMP(3);
