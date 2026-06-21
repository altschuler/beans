ALTER TABLE "bank_transactions" ADD COLUMN "ai_confidence" integer;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD COLUMN "ai_processing_started_at" timestamp;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD COLUMN "ai_reasoning" text;--> statement-breakpoint
ALTER TABLE "ledger_transactions" DROP COLUMN "ai_confidence";--> statement-breakpoint
ALTER TABLE "ledger_transactions" DROP COLUMN "ai_processing_started_at";--> statement-breakpoint
ALTER TABLE "ledger_transactions" DROP COLUMN "ai_reasoning";