CREATE TABLE "ledger_account_groups" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"group_id" text NOT NULL,
	"linked_bank_account_id" text,
	"system_key" text,
	"type" text NOT NULL,
	"normal_balance" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_transaction_movements" (
	"id" text PRIMARY KEY NOT NULL,
	"ledger_transaction_id" text NOT NULL,
	"debit_account_id" text NOT NULL,
	"credit_account_id" text NOT NULL,
	"amount" numeric(18, 4) NOT NULL,
	"currency" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"bank_transaction_id" text,
	"source" text NOT NULL,
	"status" text NOT NULL,
	"ai_confidence" numeric(5, 4),
	"date" text,
	"description" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ledger_account_groups" ADD CONSTRAINT "ledger_account_groups_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_group_id_ledger_account_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."ledger_account_groups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_linked_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("linked_bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_transaction_movements" ADD CONSTRAINT "ledger_movements_transaction_fk" FOREIGN KEY ("ledger_transaction_id") REFERENCES "public"."ledger_transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_transaction_movements" ADD CONSTRAINT "ledger_movements_debit_account_fk" FOREIGN KEY ("debit_account_id") REFERENCES "public"."ledger_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_transaction_movements" ADD CONSTRAINT "ledger_movements_credit_account_fk" FOREIGN KEY ("credit_account_id") REFERENCES "public"."ledger_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_bank_transaction_id_bank_transactions_id_fk" FOREIGN KEY ("bank_transaction_id") REFERENCES "public"."bank_transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ledger_account_groups_team_idx" ON "ledger_account_groups" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_account_groups_team_name_unique" ON "ledger_account_groups" USING btree ("team_id","name");--> statement-breakpoint
CREATE INDEX "ledger_accounts_team_idx" ON "ledger_accounts" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "ledger_accounts_group_idx" ON "ledger_accounts" USING btree ("group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_accounts_linked_bank_account_unique" ON "ledger_accounts" USING btree ("linked_bank_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_accounts_team_name_unique" ON "ledger_accounts" USING btree ("team_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_accounts_team_system_key_unique" ON "ledger_accounts" USING btree ("team_id","system_key");--> statement-breakpoint
CREATE INDEX "ledger_transaction_movements_transaction_idx" ON "ledger_transaction_movements" USING btree ("ledger_transaction_id");--> statement-breakpoint
CREATE INDEX "ledger_transaction_movements_debit_account_idx" ON "ledger_transaction_movements" USING btree ("debit_account_id");--> statement-breakpoint
CREATE INDEX "ledger_transaction_movements_credit_account_idx" ON "ledger_transaction_movements" USING btree ("credit_account_id");--> statement-breakpoint
CREATE INDEX "ledger_transactions_team_idx" ON "ledger_transactions" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_transactions_bank_transaction_unique" ON "ledger_transactions" USING btree ("bank_transaction_id");--> statement-breakpoint
CREATE INDEX "ledger_transactions_status_idx" ON "ledger_transactions" USING btree ("team_id","status");--> statement-breakpoint
CREATE INDEX "ledger_transactions_date_idx" ON "ledger_transactions" USING btree ("team_id","date");