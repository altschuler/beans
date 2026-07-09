ALTER TABLE "agent_workflow_runs" ADD COLUMN "eve_session_id" text;--> statement-breakpoint
ALTER TABLE "agent_workflow_runs" ADD COLUMN "eve_next_stream_index" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "team_data_assistant_chats" ADD COLUMN "eve_session_id" text;--> statement-breakpoint
ALTER TABLE "team_data_assistant_chats" ADD COLUMN "eve_continuation_token" text;--> statement-breakpoint
ALTER TABLE "team_data_assistant_chats" ADD COLUMN "eve_next_stream_index" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_workflow_runs" ADD CONSTRAINT "agent_workflow_runs_eve_next_stream_index_check" CHECK ("agent_workflow_runs"."eve_next_stream_index" >= 0);--> statement-breakpoint
ALTER TABLE "team_data_assistant_chats" ADD CONSTRAINT "team_data_assistant_chats_eve_next_stream_index_check" CHECK ("team_data_assistant_chats"."eve_next_stream_index" >= 0);