CREATE TABLE "agent_workflow_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"flue_run_id" text,
	"workflow_name" text NOT NULL,
	"team_id" text NOT NULL,
	"requested_by_user_id" text NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"finished_at" timestamp,
	CONSTRAINT "agent_workflow_runs_status_check" CHECK ("agent_workflow_runs"."status" in ('active', 'completed', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "agent_workflow_runs" ADD CONSTRAINT "agent_workflow_runs_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_workflow_runs" ADD CONSTRAINT "agent_workflow_runs_requested_by_user_id_user_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_workflow_runs_team_idx" ON "agent_workflow_runs" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_workflow_runs_active_unique" ON "agent_workflow_runs" USING btree ("team_id","workflow_name") WHERE "agent_workflow_runs"."status" = 'active';