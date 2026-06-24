CREATE TABLE "bank_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"bank_connection_id" text,
	"provider" text NOT NULL,
	"provider_institution_id" text NOT NULL,
	"provider_requisition_id" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"name" text NOT NULL,
	"iban" text,
	"currency" text,
	"status" text NOT NULL,
	"last_synced_at" timestamp,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bank_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"provider" text NOT NULL,
	"provider_institution_id" text NOT NULL,
	"provider_requisition_id" text NOT NULL,
	"reference" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bank_transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"bank_account_id" text NOT NULL,
	"provider_transaction_id" text NOT NULL,
	"status" text NOT NULL,
	"booking_date" text,
	"value_date" text,
	"amount" numeric(18, 4) NOT NULL,
	"currency" text NOT NULL,
	"description" text NOT NULL,
	"counterparty_name" text,
	"raw" jsonb NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_members" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"personal_owner_user_id" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_bank_connection_id_bank_connections_id_fk" FOREIGN KEY ("bank_connection_id") REFERENCES "public"."bank_connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_connections" ADD CONSTRAINT "bank_connections_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_personal_owner_user_id_user_id_fk" FOREIGN KEY ("personal_owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bank_accounts_team_idx" ON "bank_accounts" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bank_accounts_provider_account_unique" ON "bank_accounts" USING btree ("provider","provider_account_id");--> statement-breakpoint
CREATE INDEX "bank_accounts_requisition_idx" ON "bank_accounts" USING btree ("provider","provider_requisition_id");--> statement-breakpoint
CREATE INDEX "bank_connections_team_idx" ON "bank_connections" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bank_connections_reference_unique" ON "bank_connections" USING btree ("provider","reference");--> statement-breakpoint
CREATE UNIQUE INDEX "bank_connections_requisition_unique" ON "bank_connections" USING btree ("provider","provider_requisition_id");--> statement-breakpoint
CREATE INDEX "bank_transactions_account_idx" ON "bank_transactions" USING btree ("bank_account_id");--> statement-breakpoint
CREATE INDEX "bank_transactions_account_booking_date_idx" ON "bank_transactions" USING btree ("bank_account_id","booking_date");--> statement-breakpoint
CREATE UNIQUE INDEX "bank_transactions_provider_unique" ON "bank_transactions" USING btree ("bank_account_id","provider_transaction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "team_members_team_user_unique" ON "team_members" USING btree ("team_id","user_id");--> statement-breakpoint
CREATE INDEX "team_members_user_idx" ON "team_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "teams_personal_owner_unique" ON "teams" USING btree ("personal_owner_user_id");