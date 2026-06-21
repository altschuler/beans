# Sync All Bank Accounts Design

## Goal
Add a single action on both `/app` and `/app/banks` that syncs every connected bank account for the signed-in user's accessible teams.

## Approach
Add a reusable server-side sync-all path that lists accessible linked bank accounts, claims each account sync so `bank_accounts.sync_status` changes to `syncing`, runs the same details and transaction sync used by per-account sync, and continues after individual account failures. Because bank accounts are Zero-backed, the existing Zero queries on `/app` and `/app/banks` will reflect `syncing`, `idle`, or `error` status changes.

## UI
Create a reusable Sync all accounts button. Use it in the ledger dashboard header and the banking dashboard header. Disable it when there are no accounts or any queried account is currently syncing. Show a compact result message with synced, failed, and skipped counts.

## Error handling
The batch returns a summary instead of throwing when individual accounts fail. Account-level failures mark that account `sync_status = 'error'` with the error message. Unexpected auth/listing failures still surface as button-level errors.

## Testing
Add unit coverage for sequential sync-all behavior continuing after failures, including claim/status repository calls. Add render tests that both dashboards expose the Sync all accounts button.
