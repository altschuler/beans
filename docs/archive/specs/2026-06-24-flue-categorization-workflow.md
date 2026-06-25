# Flue categorization workflow

## Purpose

Replace transaction categorization orchestration with a durable, autonomous Flue workflow. The workflow should behave like a codemode agent: it can search scoped financial context broadly, reason across a team’s transactions, and apply guarded interpretations through domain tools.

This spec is intentionally split into progressive sections that can be implemented directly. Each section should leave the system in a coherent state before moving to the next one.

## Agreed direction

- Use a full agentic workflow, not a port of the current OpenAI orchestration.
- Batch is the primary workflow shape; row categorization is the same workflow constrained to one transaction.
- The web app starts Flue asynchronously and returns an app run id.
- Flue runtime tables remain internal and are not Zero-synced.
- The app owns a small Zero-synced workflow-run projection table.
- There are no per-row claims/leases in the first version.
- Concurrency uses optimistic compare-and-swap via a dedicated categorization revision.
- The agent gets broad guarded read/search tools and one guarded polymorphic write tool.
- The first batch run processes until no eligible rows remain, or until it hits 100 transactions or 10 minutes.

## Section 1 — Generic workflow-run visibility — Completed

Completed in implementation. Added app-owned workflow visibility state before changing categorization behavior.

### Data model

Add a generic table:

```txt
agent_workflow_runs
- id
- flue_run_id nullable
- workflow_name
- team_id
- requested_by_user_id
- status: active | completed | failed
- error nullable
- created_at
- updated_at
- finished_at nullable
```

Keep completed and failed rows around for now. Do not add detailed count columns in the first version.

Expose this table through Zero with team-membership authorization so the UI can answer: “which workflows are currently active for this team?”

### Repository behavior

Create shared domain helpers in `packages/domain` for:

- reserving an active app workflow run
- rejecting a new active run for the same `teamId` + `workflowName`
- attaching a `flueRunId`
- marking a run completed
- marking a run failed with a short error

The web app reserves the app run before calling Flue. Flue updates the same app run during/finally. The app run id and Flue run id are separate values.

### Acceptance

- A team can have at most one active `categorize-transactions` run.
- The app can list active workflow runs by team through Zero.
- Failed Flue admission marks the app run failed rather than leaving it active.

## Section 2 — Categorization revision CAS — Completed

Add the concurrency primitive before exposing agent writes.

### Data model

Add:

```txt
bank_transactions.categorization_revision integer not null default 0
```

This is the opaque expected revision returned by search/detail tools. Agents pass it back to write tools. The agent should not derive meaning from the number.

### Revision rules

Increment `categorization_revision` for every categorization-affecting write:

- manual category, split, or transfer
- user confirmation
- clearing categorizations
- agent category, split, transfer, or unable result
- AI metadata changes that affect review/status display

Do not rely on `updatedAt` as the concurrency token. Categorization state spans bank transaction fields, ledger transactions, and ledger postings.

### Write-state rules

Agent writes may apply only when the current row is:

- uncategorized, or
- has an existing `needs_review` interpretation that is not user-confirmed

Agent writes must reject when:

- the revision is stale
- the row is confirmed or user-confirmed
- the target row is outside the workflow target constraint
- validation fails

### Acceptance

- Manual and agent categorization-affecting writes bump the revision.
- A stale expected revision causes a structured conflict and no write.
- Confirmed/user-confirmed interpretations are protected from agent overwrite.

## Section 3 — Shared domain extraction — Completed

Move only the domain code that both `apps/web` and `apps/flue` need into `packages/domain`.

### Scope

Extract or create shared code for:

- Drizzle schema/client access used by both apps
- money helpers required by categorization
- categorization posting builders and balance validation
- `applyInterpretation` domain service with CAS
- workflow-run repository helpers
- read/search projections for agent tools

Do not extract unrelated UI code or broad ledger infrastructure. Keep the extraction focused on the Flue workflow boundary.

### Acceptance

- Web manual categorization paths still use the same domain behavior.
- Flue tools can import shared domain services without importing web-only TanStack Start modules.
- Server-only/client-only boundaries remain clear.

## Section 4 — Agent read/search tools — Completed

Implement broad but guarded read tools under `apps/flue/src/agent-tools`.

All tools receive trusted scope from runtime/tool context:

- `userId`
- `teamId`
- `appRunId`
- optional `targetBankTransactionIds`

The model never supplies those values.

### `searchBankTransactions(filters)`

Compact curated search over scoped team bank transactions.

Initial filters:

- `reviewStatus`: `uncategorized | needs_review | confirmed | ai_unable | any`
- `bankTransactionIds`
- `bankAccountIds`
- `textContains`
- `counterpartyContains`
- `currency`
- `amountMin` / `amountMax` using canonical scale-4 integer amounts
- `direction`: `inflow | outflow`
- `dateFrom` / `dateTo`
- `limit`, capped
- default sort by date descending

Results include transaction summary, current review/interpretation summary, `categorizationRevision`, and whether target constraints allow writing.

### `getBankTransactionDetail({ bankTransactionId })`

Richer allowlisted context for one transaction:

- transaction fields
- bank account context
- current ledger interpretation and postings
- `categorizationRevision`

Do not expose provider `raw` in the first version.

### `searchLedgerTransactions(filters)`

Used for examples, confirmed splits, and transfer context.

Initial filters:

- `status`
- `source`
- `categorizedBy`
- `bankTransactionId`
- `categoryAccountIds`
- `textContains`
- `currency`
- amount/date filters
- `direction`
- `limit`, capped

Results summarize postings enough to identify single-category, split, or transfer interpretations, and confirmed/user-confirmed vs AI-confirmed status.

### `searchLedgerAccounts(filters)`

Used for categories and bank-linked transfer accounts.

Initial filters:

- account type
- status
- text search
- linked-bank-account presence
- eligible-category-only flag

### Acceptance

- All reads are scoped by `userId` and `teamId`.
- General search can show rows changed by users or other future agents; context should not be hidden.
- Search results are compact, stable projections rather than raw DB rows.

## Section 5 — `applyInterpretation` write tool — Completed

Expose one polymorphic guarded write tool to the agent.

```ts
applyInterpretation({
  bankTransactionId,
  expectedCategorizationRevision,
  confidence: 0 | 1 | 2,
  reasoning,
  interpretation:
    | {kind: 'unable'}
    | {kind: 'category', categoryAccountId}
    | {kind: 'split', lines: [{categoryAccountId, amount}]}
    | {kind: 'transfer', counterBankTransactionId}
})
```

### Validation rules

- `unable` requires confidence `0`.
- `category` and `transfer` require confidence `1 | 2`.
- `split` always stores confidence `1` and leaves the interpretation `needs_review`.
- Category accounts must be active, same-team, real categorization accounts.
- Transfers require a valid same-team opposite bank transaction.
- Split lines must balance to the absolute bank transaction amount.
- Reasoning is required, concise, and display-safe.
- The target bank transaction must be scoped, target-allowed, and revision-matching.

### Confirmation rules

- Category and transfer may be AI-confirmed when confidence is `2`.
- Category and transfer with confidence `1` stay `needs_review`.
- Splits always stay `needs_review`, even if the agent attempts confidence `2`.
- Unable records confidence `0` and reasoning without creating/replacing an interpretation.

### Conflict behavior

A stale revision returns a structured conflict. The agent may re-read and decide whether retrying still makes sense, but instructions must prohibit blind replay.

### Acceptance

- The tool can apply category, transfer, split, and unable outcomes through shared domain logic.
- Invalid account ids, unsafe transfers, unbalanced splits, stale revisions, and protected confirmed rows are rejected without partial writes.

## Section 6 — Flue workflow and agent instructions — Completed

Implement `apps/flue/src/workflows/categorize-transactions.ts` as a durable, autonomous workflow.

### Workflow input

```txt
appRunId
userId
teamId
targetBankTransactionIds optional
```

Row action passes one target id. Batch action passes no target ids.

### Agent mission

The agent should be instructed to:

1. Find eligible transactions within target constraints.
2. Use ledger accounts and historical ledger transactions as context.
3. Search broadly; visible manual changes and other rows may be useful context.
4. Apply category or transfer when confident.
5. Apply split only when strongly grounded in very similar confirmed prior split transactions.
6. Record `unable` with useful concise reasoning for unresolved rows.
7. Continue until no eligible rows remain or 100 transactions / 10 minutes is reached.
8. Never invent account ids, ignore target constraints, or expose private reasoning.

### Runtime behavior

- Web reserves the app run before invoking Flue.
- Flue keeps/marks the app run active on start.
- In a `finally` path, Flue marks the app run `completed` or `failed`.
- No detailed counts are required in the workflow output.

### Acceptance

- A batch run can autonomously work through eligible rows until exhausted or capped.
- A row run is constrained to the requested transaction.
- Failure does not leave row locks, because there are no row locks.

## Section 7 — Web integration and UI behavior — Completed

Replace current synchronous AI categorization entry points with workflow starters.

### Server functions

`aiCategorizeTransaction({ bankTransactionId })`:

- authenticate user
- resolve and authorize team from the bank transaction
- reject if active categorize workflow exists for the team
- reserve an `agent_workflow_runs` row
- start Flue with `targetBankTransactionIds: [bankTransactionId]`
- return `{appRunId}`

`aiCategorizeNeedsReviewBatch()`:

- authenticate user
- resolve current/active team
- reject if active categorize workflow exists for the team
- reserve an `agent_workflow_runs` row
- start Flue without target ids
- return `{appRunId}`

The old batch `limit` is dropped for the agentic workflow.

### UI behavior

First version:

- Show a team-level active workflow indicator when a categorize workflow is active.
- Disable row and batch AI buttons while a categorize workflow is active for the team.
- Rows update through existing Zero reads as interpretations or unable states are written.
- Do not show per-row processing state in the first version.

Future TODO: add a soft per-row “agent is considering this row” activity marker. It should be informational only, not a claim or write lock.

### Acceptance

- Starting a workflow returns quickly with an app run id.
- The UI can show team-level active workflow state through Zero.
- Duplicate starts are rejected with a user-facing “AI categorization is already running for this team” style message.

## Section 8 — Testing and verification — Completed

Test each section at the domain/tool boundary before relying on full agent behavior.

### Required tests

- Workflow-run repository rejects duplicate active runs.
- Flue admission failure marks app run failed.
- Revision increments on categorization-affecting writes.
- Stale expected revisions reject writes without mutation.
- `applyInterpretation` rejects confirmed/user-confirmed rows.
- `applyInterpretation` validates categories, transfers, and splits.
- Tool reads are scoped by `userId` and `teamId`.
- Target-constrained row workflow cannot write other rows.
- Web server functions reserve and start runs correctly.

Add a small Flue workflow smoke test if the local Flue test harness is practical. Otherwise, keep behavior covered through domain and tool tests, with manual local smoke testing for the agent loop.
