UPDATE "team_data_assistant_chats"
SET
  "eve_session_id" = NULL,
  "eve_continuation_token" = NULL,
  "eve_session_ordinal" = 0,
  "eve_next_stream_index" = 0,
  "eve_session_state" = 'none',
  "eve_turn_started_at" = NULL,
  "eve_admission_id" = NULL;
