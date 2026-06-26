# AI categorization

## Purpose

AI categorization suggests categories for imported bank transactions. It is a review accelerator, not the authority of record. Server-side validation decides whether a model suggestion is allowed to affect ledger data.

## Server boundary

AI categorization starts through TanStack server functions, but the long-running work runs in the Flue sidecar, not in a Zero mutator or a synchronous web request. This keeps model/tool work outside Zero mutation processing while still letting clients read resulting domain state through Zero.

Current entry points:

- single-row AI categorize by `bankTransactionId`
- team batch AI categorize for eligible needs-review transactions

The web server function authenticates the user, resolves and authorizes the team, reserves an `agent_workflow_runs` row, invokes Flue asynchronously, and returns `{appRunId}` as soon as Flue accepts the workflow. The app run id is the web-visible workflow projection id; the Flue run id is separate and attached later by the Flue workflow lifecycle.

Only one active `categorize-transactions` workflow may exist for a team. Duplicate starts fail with a user-facing “AI categorization is already running for this team” style error.

## Workflow visibility and UI state

`agent_workflow_runs` is the app-owned, Zero-synced workflow projection. The Transactions page reads active `categorize-transactions` runs for the current team and uses that team-level state to:

- show that AI categorization is running for the team
- disable row and batch AI start buttons while the workflow is active
- continue showing row updates through existing Zero transaction reads as Flue writes interpretations or unable results

Penge does not show per-row “agent is considering this row” state. The historical `bank_transactions.ai_processing_started_at` row-level claim has been retired; Flue categorization uses team-level workflow visibility rather than row-level processing claims.

## Agent context

The Flue workflow receives trusted scope from the web app:

- `appRunId`
- `userId`
- `teamId`
- optional `targetBankTransactionIds` for a row-constrained run

The model never supplies authorization scope. Flue tools use the trusted scope to search bank transactions, ledger transactions, and ledger accounts, then apply guarded interpretations through shared domain services.

Eligible AI categories are active real categories: income, expense, or savings accounts with no linked bank account and no system key. Historical confirmed examples remain useful context, but the workflow now obtains them through broad scoped ledger search rather than a web-built prompt batch.

## Confidence scale

AI confidence is an integer enum:

- `0`: could not categorize reliably. No category is applied; the transaction still needs review.
- `1`: plausible. The category is applied but the transaction still needs review.
- `2`: confident. The category is applied and the interpretation is marked confirmed by AI.

The model must also return concise display-safe reasoning. Reasoning is stored on the bank transaction and can appear in the status tooltip.

## Applying interpretations

The autonomous Flue categorizer writes through one guarded `applyCategorizationSuggestion` tool. It can record:

- `unable` with confidence `0` and concise display-safe reasoning
- a single category
- a split, when strongly grounded in similar confirmed prior splits
- a transfer, when a valid same-team opposite bank transaction exists

For confidence `1` or `2`, AI uses the same bank-transaction-first interpretation path as manual categorization, with `categorizedBy = 'ai'`. Category and transfer interpretations may be AI-confirmed at confidence `2`; confidence `1` stays needs-review. Splits always stay needs-review. For confidence `0`, AI records the confidence and reasoning on the bank transaction without creating or replacing a ledger interpretation.

AI application is guarded by `bank_transactions.categorization_revision`. Tools read the current revision and must pass it back when writing. Stale revisions, confirmed/user-confirmed rows, invalid categories, unsafe transfers, unbalanced splits, and rows outside the workflow target constraint are rejected without partial writes.

## User confirmation after AI

High-confidence AI rows can be confirmed by the user from the status dot. This preserves both facts:

- AI set the category (`categorizedBy = 'ai'`)
- a user later confirmed the interpretation (`userConfirmedAt` / `userConfirmedBy`)

That distinction is why the UI uses separate soft-green and bright-green states.
