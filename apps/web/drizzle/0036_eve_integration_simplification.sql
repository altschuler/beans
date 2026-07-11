ALTER TABLE "agent_workflow_runs" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "team_data_assistant_chat_approvals" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "team_data_assistant_chat_events" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "agent_workflow_runs" CASCADE;--> statement-breakpoint
DROP TABLE "team_data_assistant_chat_approvals" CASCADE;--> statement-breakpoint
DROP TABLE "team_data_assistant_chat_events" CASCADE;--> statement-breakpoint
ALTER TABLE "team_data_assistant_chats" DROP CONSTRAINT "team_data_assistant_chats_eve_session_ordinal_check";--> statement-breakpoint
ALTER TABLE "team_data_assistant_chats" DROP CONSTRAINT "team_data_assistant_chats_eve_next_stream_index_check";--> statement-breakpoint
ALTER TABLE "team_data_assistant_chats" DROP CONSTRAINT "team_data_assistant_chats_eve_session_state_check";--> statement-breakpoint
ALTER TABLE "team_data_assistant_chats" DROP CONSTRAINT "team_data_assistant_chats_eve_follow_up_delivery_state_check";--> statement-breakpoint
ALTER TABLE "team_data_assistant_chats" DROP CONSTRAINT "team_data_assistant_chats_eve_follow_up_pre_turn_cursor_check";--> statement-breakpoint
ALTER TABLE "team_data_assistant_chats" DROP CONSTRAINT "team_data_assistant_chats_eve_follow_up_delivery_marker_check";--> statement-breakpoint
DROP INDEX "team_data_assistant_chats_session_state_turn_started_idx";--> statement-breakpoint
ALTER TABLE "team_data_assistant_chats" DROP COLUMN "eve_session_ordinal";--> statement-breakpoint
ALTER TABLE "team_data_assistant_chats" DROP COLUMN "eve_next_stream_index";--> statement-breakpoint
ALTER TABLE "team_data_assistant_chats" DROP COLUMN "eve_session_state";--> statement-breakpoint
ALTER TABLE "team_data_assistant_chats" DROP COLUMN "eve_turn_started_at";--> statement-breakpoint
ALTER TABLE "team_data_assistant_chats" DROP COLUMN "eve_admission_id";--> statement-breakpoint
ALTER TABLE "team_data_assistant_chats" DROP COLUMN "eve_follow_up_delivery_state";--> statement-breakpoint
ALTER TABLE "team_data_assistant_chats" DROP COLUMN "eve_follow_up_pre_turn_cursor";