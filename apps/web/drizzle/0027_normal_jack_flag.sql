CREATE TABLE "agent_tool_executions" (
	"id" text PRIMARY KEY NOT NULL,
	"eve_session_id" text NOT NULL,
	"call_id" text NOT NULL,
	"purpose" text NOT NULL,
	"tool_name" text NOT NULL,
	"team_id" text NOT NULL,
	"user_id" text NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_tool_executions" ADD CONSTRAINT "agent_tool_executions_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_tool_executions" ADD CONSTRAINT "agent_tool_executions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_tool_executions_session_call_unique" ON "agent_tool_executions" USING btree ("eve_session_id","call_id");--> statement-breakpoint
CREATE INDEX "agent_tool_executions_team_idx" ON "agent_tool_executions" USING btree ("team_id");