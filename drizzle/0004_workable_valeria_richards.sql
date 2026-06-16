ALTER TABLE "bank_accounts" ADD COLUMN "sync_status" text DEFAULT 'idle' NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD COLUMN "sync_error" text;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD COLUMN "sync_started_at" timestamp;