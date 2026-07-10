CREATE TABLE "team_data_assistant_chat_approvals" (
	"id" text PRIMARY KEY NOT NULL,
	"chat_id" text NOT NULL,
	"eve_session_id" text NOT NULL,
	"session_ordinal" integer NOT NULL,
	"request_id" text NOT NULL,
	"call_id" text NOT NULL,
	"tool_name" text NOT NULL,
	"safe_proposal" jsonb,
	"projection_status" text NOT NULL,
	"resolution_status" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "team_data_assistant_chat_approvals_session_ordinal_check" CHECK ("team_data_assistant_chat_approvals"."session_ordinal" >= 0),
	CONSTRAINT "team_data_assistant_chat_approvals_projection_status_check" CHECK ("team_data_assistant_chat_approvals"."projection_status" in ('ready', 'blocked')),
	CONSTRAINT "team_data_assistant_chat_approvals_resolution_status_check" CHECK ("team_data_assistant_chat_approvals"."resolution_status" in ('pending', 'approved', 'denied', 'completed'))
);
--> statement-breakpoint
CREATE TABLE "team_data_assistant_chat_events" (
	"id" text PRIMARY KEY NOT NULL,
	"chat_id" text NOT NULL,
	"eve_session_id" text NOT NULL,
	"session_ordinal" integer NOT NULL,
	"stream_index" integer NOT NULL,
	"type" text NOT NULL,
	"event" jsonb NOT NULL,
	"occurred_at" timestamp NOT NULL,
	"created_at" timestamp NOT NULL,
	CONSTRAINT "team_data_assistant_chat_events_session_ordinal_check" CHECK ("team_data_assistant_chat_events"."session_ordinal" >= 0),
	CONSTRAINT "team_data_assistant_chat_events_stream_index_check" CHECK ("team_data_assistant_chat_events"."stream_index" >= 0)
);
--> statement-breakpoint
ALTER TABLE "team_data_assistant_chats" ADD COLUMN "eve_session_ordinal" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "team_data_assistant_chats" ADD COLUMN "eve_session_state" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "team_data_assistant_chats" ADD COLUMN "eve_turn_started_at" timestamp;--> statement-breakpoint
ALTER TABLE "team_data_assistant_chats" ADD COLUMN "eve_admission_id" text;--> statement-breakpoint
ALTER TABLE "team_data_assistant_chat_approvals" ADD CONSTRAINT "team_data_assistant_chat_approvals_chat_id_team_data_assistant_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."team_data_assistant_chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_data_assistant_chat_events" ADD CONSTRAINT "team_data_assistant_chat_events_chat_id_team_data_assistant_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."team_data_assistant_chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "team_data_assistant_chat_approvals_chat_session_request_unique" ON "team_data_assistant_chat_approvals" USING btree ("chat_id","eve_session_id","request_id");--> statement-breakpoint
CREATE INDEX "team_data_assistant_chat_approvals_ordered_idx" ON "team_data_assistant_chat_approvals" USING btree ("chat_id","session_ordinal","request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "team_data_assistant_chat_events_chat_session_stream_unique" ON "team_data_assistant_chat_events" USING btree ("chat_id","eve_session_id","stream_index");--> statement-breakpoint
CREATE UNIQUE INDEX "team_data_assistant_chat_events_chat_ordinal_stream_unique" ON "team_data_assistant_chat_events" USING btree ("chat_id","session_ordinal","stream_index");--> statement-breakpoint
CREATE INDEX "team_data_assistant_chat_events_ordered_idx" ON "team_data_assistant_chat_events" USING btree ("chat_id","session_ordinal","stream_index");--> statement-breakpoint
ALTER TABLE "team_data_assistant_chats" DROP COLUMN "current_page";--> statement-breakpoint
ALTER TABLE "team_data_assistant_chats" ADD CONSTRAINT "team_data_assistant_chats_eve_session_ordinal_check" CHECK ("team_data_assistant_chats"."eve_session_ordinal" >= 0);--> statement-breakpoint
ALTER TABLE "team_data_assistant_chats" ADD CONSTRAINT "team_data_assistant_chats_eve_session_state_check" CHECK ("team_data_assistant_chats"."eve_session_state" in ('none', 'admitting', 'running', 'waiting', 'completed', 'failed'));