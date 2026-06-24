# Refresh-Safe Long-Running Tasks Design

## Status

Obsolete. This start-and-return server-task design was superseded before implementation by the decision to use an agent harness for long-running AI categorization and related work. Kept for historical context only.

## Summary

Make AI categorization and bank sync independent of browser/client component state. The first version should not introduce a generic jobs table or an external durable queue. Instead, use persisted domain processing fields as the source of truth, start work on the server, return quickly to the client, and let Zero updates drive the UI.

This gives the desired behavior for page refreshes and navigation without committing to full crash-durable background jobs.

## Goals

- Users can refresh the page after starting AI categorization or bank sync and still see that work is running.
- Long-running work should not depend on React state or an open browser request for user-visible status.
- Existing domain state should remain the source of truth where it already exists:
  - `bank_transactions.ai_processing_started_at` for AI categorization
  - `bank_accounts.sync_status`, `sync_started_at`, `sync_error`, and `last_synced_at` for bank sync
- The implementation should stay small and avoid a generic job system for now.

## Non-goals

- No generic `jobs` table.
- No external queue or worker dependency.
- No guarantee that work survives a server crash.
- No detailed progress history or durable job logs.
- No retry scheduler beyond making stale processing state retryable.

## Current problem

AI categorization and bank sync currently use server functions that perform the full long-running operation before returning to the client. The UI also has component-local pending state, such as `isAiRequestPending` and `isSyncingAll`, which means the visible task state is partly tied to the current browser session.

Some persisted row-level processing state already exists, but the server function lifecycle still acts like the operation is request/response rather than a background task.

## Architecture

Use a lightweight start-and-continue pattern:

1. A client action calls a server function to start a task.
2. The server function authenticates and authorizes the request.
3. The server function claims the relevant domain rows by writing persisted processing state in a short database update.
4. The server starts the long-running work in-process without awaiting it before returning to the client.
5. The server function returns a small start result, such as `{started: n}`.
6. The UI reads domain processing state through Zero and renders running/completed/error states from synced data.
7. The background work clears processing state in a `finally` path and writes any result state.

The background continuation may be implemented with an internal helper that starts an async task and catches/logs errors so unhandled promise rejections do not escape.

## AI categorization flow

AI categorization is bank-transaction-first. The processing marker and AI result metadata live on `bank_transactions`, while category application creates or updates the bank transaction's ledger interpretation through the existing categorization service.

### Start batch categorization

The dashboard batch action should call a start-style server function, for example `startAiCategorizeNeedsReviewBatch`.

Server behavior:

1. Authenticate with `ensureSession()`.
2. Select and authorize up to the requested capped limit of eligible imported bank transactions.
3. Eligibility means the bank transaction is accessible to the user, has no fresh AI processing marker, and its current ledger interpretation is either missing or still needs review.
4. Claim retryable transactions by setting `bank_transactions.ai_processing_started_at = now()` where the field is null or stale.
5. Return quickly with the number of claimed transactions.
6. Continue the existing LLM categorization flow in-process for the claimed bank transaction ids.

Background behavior:

1. Load prompt inputs and similar examples for the claimed bank transactions.
2. Call the LLM.
3. Validate suggestions.
4. Apply valid results:
   - confidence `0`: record AI confidence/reasoning on the bank transaction, leave category and status needing review
   - confidence `1`: apply category, keep `needs_review`
   - confidence `2`: apply category, mark `confirmed`
5. Preserve the existing race guard: before applying a model result, verify the bank transaction still has the processing marker owned by this run. Stale model results must not overwrite user changes or another AI run.
6. Clear `bank_transactions.ai_processing_started_at` for the claimed transactions in a `finally` path.

### Start single transaction categorization

The per-row action uses the same path with one requested `bankTransactionId`. It claims that bank transaction, returns quickly, and runs the same background continuation for the claimed id.

### Stale processing state

Keep the existing stale cutoff behavior. A bank transaction with old `ai_processing_started_at` should not be treated as actively processing forever and should be claimable by a later attempt.

## Bank sync flow

Bank sync should follow the same pattern using the existing bank account sync fields.

### Start one bank account sync

The per-account sync server function should:

1. Authenticate and authorize the bank account.
2. Claim the account by setting `sync_status = 'syncing'`, `sync_started_at = now()`, and clearing `sync_error` when it is not already actively syncing.
3. Treat stale `sync_status = 'syncing'` rows as retryable based on `sync_started_at`.
4. Return quickly.
5. Continue the existing account details and transaction sync in-process.

The background continuation should mark the account idle on success, or mark it error with `sync_error` on failure.

### Start sync all bank accounts

The sync-all server function should:

1. Authenticate.
2. List accessible linked bank accounts.
3. Claim the accounts that are not already actively syncing, treating stale syncing accounts as retryable.
4. Return quickly with a count of claimed/skipped accounts.
5. Continue sync sequentially or with a small bounded concurrency in-process.

The first version can keep the existing sequential behavior.

### Stale bank sync state

If `sync_status = 'syncing'` has an old `sync_started_at`, the account should be claimable again. This mirrors the AI stale processing cutoff and prevents permanent stuck sync buttons after interrupted work.

## UI behavior

Client state should only represent the short start request, not the long-running task.

### AI UI

- Replace “finished” toasts with “AI categorization started.”
- Disable start buttons while the start request is being sent.
- Also disable per-row AI buttons when that row has fresh `bankTransactions.aiProcessingStartedAt`.
- Show global “AI running · N processing” from Zero-derived bank transaction state.
- Completion appears naturally when Zero syncs changed transaction category/status/confidence and processing clears.
- If background AI fails, rows should stop processing and remain needing review. The UI can show the existing safe failure toast only for failures to start the task.

### Bank sync UI

- Replace “sync finished” assumptions with “Bank sync started.”
- Disable sync buttons while the short start request is being sent.
- Also disable actions for accounts that are freshly syncing according to Zero state.
- Show syncing/error/last-synced state from `bank_accounts` fields.
- Completion appears when Zero syncs `sync_status`, `sync_error`, and `last_synced_at` changes.

## Error handling

Start-time errors should be returned to the client and shown immediately:

- unauthenticated user
- inaccessible transaction or bank account
- no eligible rows to claim
- missing required configuration that can be checked before starting

Background errors should be handled server-side:

- log the failure
- clear AI processing flags or mark bank sync error in persisted state
- avoid unhandled promise rejections
- leave domain data in a safe retryable state

For AI categorization, an LLM failure should leave transaction categories/statuses unchanged, clear processing flags, and allow retry.

For bank sync, provider failures should use the existing `sync_status = 'error'` and `sync_error` fields.

## Implementation notes

- Split AI categorization into a claim/start phase and a run-claimed phase so the start server function can return after claiming bank transaction rows.
- Keep using `bankTransactionId` at the server-function and UI boundary.
- Avoid relying on a returned AI summary for user-visible completion messaging because the client will not await completion.
- Split bank sync into a claim/start phase and a sync-already-claimed phase so provider calls happen only in the background continuation.
- Keep Zero as the read path for app/domain task state.
- Keep long-running external calls out of Zero mutators.
- The in-process background helper should catch errors and should not be used for work that must survive server restarts.

## Testing plan

Add or update focused tests for:

- AI start server function claims eligible bank transactions and returns without awaiting the model call.
- AI background continuation clears `bankTransactions.aiProcessingStartedAt` on success and failure.
- AI stale processing timestamps are retryable.
- AI background application preserves the processing-marker race guard.
- AI UI shows running state from Zero bank transaction data rather than only local pending state.
- AI buttons use local pending state only for the short start request.
- Bank account sync claim treats stale `syncing` accounts as retryable.
- Sync-all start returns claimed/skipped counts and does not await provider transaction fetching.
- Bank sync background continuation marks success and failure in persisted account fields.
- UI copy says started/running rather than finished when the start request returns.

## Out of scope

- Generic job list/history UI.
- User-visible progress percentages beyond counts derivable from synced domain rows.
- Cancellation.
- Cross-process worker coordination beyond simple database claiming.
- Crash-durable retry processing.
