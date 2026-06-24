ALTER TABLE "ledger_transactions" ADD COLUMN "categorized_by" text;--> statement-breakpoint
UPDATE "ledger_transactions"
SET "categorized_by" = CASE
  WHEN "ai_confidence" IS NOT NULL THEN 'ai'
  WHEN "status" = 'confirmed' THEN 'user'
  ELSE NULL
END;
