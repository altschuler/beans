DELETE FROM "agent_workflow_runs";--> statement-breakpoint
ALTER TABLE "agent_workflow_runs" DROP CONSTRAINT "agent_workflow_runs_status_check";--> statement-breakpoint
DROP INDEX "agent_workflow_runs_active_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "agent_workflow_runs_active_unique" ON "agent_workflow_runs" USING btree ("team_id","workflow_name") WHERE "agent_workflow_runs"."status" in ('pending', 'running');--> statement-breakpoint
ALTER TABLE "agent_workflow_runs" ADD CONSTRAINT "agent_workflow_runs_status_check" CHECK ("agent_workflow_runs"."status" in ('pending', 'running', 'completed', 'failed'));