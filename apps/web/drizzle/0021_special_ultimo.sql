CREATE TABLE "team_data_assistant_chats" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"last_used_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "team_data_assistant_chats" ADD CONSTRAINT "team_data_assistant_chats_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_data_assistant_chats" ADD CONSTRAINT "team_data_assistant_chats_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "team_data_assistant_chats_team_user_last_used_idx" ON "team_data_assistant_chats" USING btree ("team_id","user_id","last_used_at");--> statement-breakpoint
CREATE INDEX "team_data_assistant_chats_user_idx" ON "team_data_assistant_chats" USING btree ("user_id");