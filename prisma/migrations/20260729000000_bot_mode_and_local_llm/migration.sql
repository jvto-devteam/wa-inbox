-- Bot mode: invert+rename Settings.botKillSwitch -> Settings.botAutoReplyAll so the existing
-- row keeps the same effective behavior across the rename (old botKillSwitch=false meant
-- "bot normally active", which is the new botAutoReplyAll=true / "On" state).
ALTER TABLE "Settings" ADD COLUMN "botAutoReplyAll" BOOLEAN NOT NULL DEFAULT true;
UPDATE "Settings" SET "botAutoReplyAll" = NOT "botKillSwitch";

ALTER TABLE "Settings" DROP COLUMN "botKillSwitch";
ALTER TABLE "Settings" DROP COLUMN "killSwitchEnabledAt";
ALTER TABLE "Settings" DROP COLUMN "openaiModel";

-- Local-only LLM: OpenAI is gone, so the singleton row's ollamaModel moves to the model this
-- app now actually calls (src/lib/bot/llm.ts), not just the column default for future rows.
ALTER TABLE "Settings" ALTER COLUMN "ollamaModel" SET DEFAULT 'gemma4:31b-cloud';
UPDATE "Settings" SET "ollamaModel" = 'gemma4:31b-cloud';
