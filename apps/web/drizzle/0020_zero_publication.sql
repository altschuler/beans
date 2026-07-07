DROP PUBLICATION IF EXISTS "penge_zero_app";
--> statement-breakpoint
CREATE PUBLICATION "penge_zero_app" FOR TABLE
  "teams",
  "team_members",
  "agent_workflow_runs",
  "bank_connections",
  "bank_accounts",
  "bank_transactions",
  "ledger_account_groups",
  "ledger_accounts",
  "ledger_transactions",
  "ledger_postings";
