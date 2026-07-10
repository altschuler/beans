ALTER TABLE "team_data_assistant_chat_approvals" ADD COLUMN "eve_claimed_by_admission_id" text;--> statement-breakpoint
ALTER TABLE "team_data_assistant_chats" ADD COLUMN "eve_follow_up_delivery_state" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "team_data_assistant_chats" ADD COLUMN "eve_follow_up_pre_turn_cursor" integer;--> statement-breakpoint
ALTER TABLE "team_data_assistant_chat_approvals" ADD CONSTRAINT "team_data_assistant_chat_approvals_pending_claim_owner_check" CHECK ("team_data_assistant_chat_approvals"."resolution_status" <> 'pending' or "team_data_assistant_chat_approvals"."eve_claimed_by_admission_id" is null);--> statement-breakpoint
ALTER TABLE "team_data_assistant_chats" ADD CONSTRAINT "team_data_assistant_chats_eve_follow_up_delivery_state_check" CHECK ("team_data_assistant_chats"."eve_follow_up_delivery_state" in ('none', 'pending', 'ambiguous', 'acknowledged'));--> statement-breakpoint
ALTER TABLE "team_data_assistant_chats" ADD CONSTRAINT "team_data_assistant_chats_eve_follow_up_pre_turn_cursor_check" CHECK ("team_data_assistant_chats"."eve_follow_up_pre_turn_cursor" is null or "team_data_assistant_chats"."eve_follow_up_pre_turn_cursor" >= 0);--> statement-breakpoint
ALTER TABLE "team_data_assistant_chats" ADD CONSTRAINT "team_data_assistant_chats_eve_follow_up_delivery_marker_check" CHECK (("team_data_assistant_chats"."eve_follow_up_delivery_state" = 'none' and "team_data_assistant_chats"."eve_follow_up_pre_turn_cursor" is null)
        or ("team_data_assistant_chats"."eve_follow_up_delivery_state" in ('pending', 'ambiguous', 'acknowledged')
          and "team_data_assistant_chats"."eve_session_state" = 'running'
          and "team_data_assistant_chats"."eve_admission_id" is not null
          and "team_data_assistant_chats"."eve_follow_up_pre_turn_cursor" is not null));