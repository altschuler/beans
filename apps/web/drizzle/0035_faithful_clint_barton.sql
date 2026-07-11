ALTER TABLE "agent_workflow_runs" DROP COLUMN "flue_run_id";

DROP TABLE IF EXISTS "flue_agent_attempt_markers" CASCADE;
DROP TABLE IF EXISTS "flue_agent_dispatch_receipts" CASCADE;
DROP TABLE IF EXISTS "flue_agent_submissions" CASCADE;
DROP TABLE IF EXISTS "flue_attachments" CASCADE;
DROP TABLE IF EXISTS "flue_conversation_stream_batches" CASCADE;
DROP TABLE IF EXISTS "flue_conversation_streams" CASCADE;
DROP TABLE IF EXISTS "flue_event_stream_entries" CASCADE;
DROP TABLE IF EXISTS "flue_event_streams" CASCADE;
DROP TABLE IF EXISTS "flue_image_chunks" CASCADE;
DROP TABLE IF EXISTS "flue_meta" CASCADE;
DROP TABLE IF EXISTS "flue_runs" CASCADE;