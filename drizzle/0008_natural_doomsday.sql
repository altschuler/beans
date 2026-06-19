ALTER TABLE "ledger_transactions" ADD COLUMN "user_confirmed_at" timestamp;--> statement-breakpoint
ALTER TABLE "ledger_transactions" ADD COLUMN "user_confirmed_by" text;--> statement-breakpoint
ALTER TABLE "ledger_transactions" ADD COLUMN "ai_reasoning" text;--> statement-breakpoint
UPDATE "ledger_transactions"
SET "user_confirmed_at" = "updated_at"
WHERE "status" = 'confirmed' AND "categorized_by" = 'user';