-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "ollamaModel" TEXT NOT NULL DEFAULT 'llama3',
ADD COLUMN     "openaiModel" TEXT NOT NULL DEFAULT 'gpt-4o-mini';
