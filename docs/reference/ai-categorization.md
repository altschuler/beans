# AI categorization

## Purpose

AI categorization suggests interpretations for imported bank transactions. It accelerates review; server-side domain validation remains authoritative.

## Runtime boundary

TanStack server functions authenticate the user and authorize the team, then reserve an app-owned `agent_workflow_runs` row before starting an Eve task-mode session. Model work stays outside Zero mutators and long-lived database transactions. The server returns `{appRunId}` after Eve admits the task.

Entry points support one target bank transaction or an eligible team batch. Only one `categorize-transactions` run may be `pending` or `running` for a team.

The web app mints a short-lived `categorization-task` capability scoped to `{appRunId, userId, teamId, targetBankTransactionIds?}`. Eve verifies it and stamps trusted session auth. The model never supplies authorization scope or target constraints.

## Workflow visibility and trace

`agent_workflow_runs` is the Zero-synced product projection:

- `pending`: reserved, session not attached;
- `running`: Eve session attached;
- `completed` or `failed`: terminal.

Eve session ids and stream cursors are server-only. The Transactions page disables duplicate starts while a run is active and renders a compact trace from an authenticated app-run route. The route reads Eve's durable stream with a separate read-only `categorization-trace` capability and forwards only sanitized activity. Tool inputs, outputs, provider metadata, runtime ids, reasoning, and raw errors never reach the browser.

The trace is active-run visibility only. Product facts and categorized rows continue to arrive through normal Zero domain reads. Terminal status comes from the app run row; reconciliation converges it from Eve's durable stream if the best-effort completion callback is missed.

## Agent context and tools

Categorization receives trusted `appRunId`, `userId`, `teamId`, and an optional exact target set. It can use scoped finance reads and only the autonomous `applyCategorizationSuggestion` write tool. Task sessions cannot ask questions, wait for approval, or use sandbox tools.

The task stops when eligible targets are exhausted, after 100 attempts, after ten minutes, or when it cannot safely continue. Target constraints are enforced by the write tool, not only by instructions.

## Confidence scale

- `0`: unable to categorize reliably; no ledger category is applied.
- `1`: plausible; applied but still needs review.
- `2`: confident; applied and marked confirmed by AI.

Every result includes concise display-safe reasoning.

## Guarded application

The task may record unable, category, split, or transfer results through shared domain services. Every write requires the current `categorizationRevision`. Stale revisions, protected user-confirmed rows, invalid categories, unsafe transfers, unbalanced splits, and out-of-target rows fail without partial writes. Imported bank evidence is never mutated or deleted.

High-confidence AI rows can later be confirmed by a user while preserving both the original AI attribution and user-confirmation metadata.
