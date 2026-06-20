CREATE TABLE "ledger_postings" (
	"id" text PRIMARY KEY NOT NULL,
	"ledger_transaction_id" text NOT NULL,
	"account_id" text NOT NULL,
	"amount" numeric(18, 4) NOT NULL,
	"currency" text NOT NULL,
	"bank_transaction_id" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ledger_transaction_movements" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "ledger_transaction_movements" CASCADE;--> statement-breakpoint
ALTER TABLE "ledger_transactions" DROP CONSTRAINT "ledger_transactions_bank_transaction_id_bank_transactions_id_fk";
--> statement-breakpoint
DROP INDEX "ledger_transactions_bank_transaction_unique";--> statement-breakpoint
ALTER TABLE "ledger_postings" ADD CONSTRAINT "ledger_postings_transaction_fk" FOREIGN KEY ("ledger_transaction_id") REFERENCES "public"."ledger_transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_postings" ADD CONSTRAINT "ledger_postings_account_fk" FOREIGN KEY ("account_id") REFERENCES "public"."ledger_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_postings" ADD CONSTRAINT "ledger_postings_bank_transaction_fk" FOREIGN KEY ("bank_transaction_id") REFERENCES "public"."bank_transactions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ledger_postings_transaction_idx" ON "ledger_postings" USING btree ("ledger_transaction_id");--> statement-breakpoint
CREATE INDEX "ledger_postings_account_idx" ON "ledger_postings" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_postings_bank_transaction_unique" ON "ledger_postings" USING btree ("bank_transaction_id");--> statement-breakpoint
ALTER TABLE "ledger_transactions" DROP COLUMN "bank_transaction_id";