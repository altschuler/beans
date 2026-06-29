# Interactive bulk categorization

## Summary

Initial categorization of a large imported backlog should be handled by the existing Ask Penge chat assistant, not by the autonomous AI categorization workflow. The autonomous workflow remains the non-interactive background path for new bank-sync transactions. The chat assistant gains a specialized bulk categorization mode that can ask the user to confirm uncertain group-level mappings before applying guarded categorization writes.

The mode is workspace-driven: for large categorization runs, the assistant uses Flue's virtual filesystem as its working context. It ingests scoped database results once, maintains JSONL/JSON files for transactions, categories, groups, decisions, and progress, and avoids repeated exploratory database reads except for missing data, stale/conflicted rows, refreshes, or guarded final writes.

## Problem

The current auto-categorization workflow is not a good fit for initial categorization of a few hundred imported transactions because it is autonomous and non-interactive. It can search database-backed tools and apply guarded suggestions, but it cannot ask the user clarifying questions such as:

> I found 23 transactions from Rema 1000, Netto, and Føtex that look like grocery purchases. Should I categorize those as Groceries?

Without many prior confirmed examples, fully autonomous categorization either becomes too conservative or risks invisible mistakes. The better product behavior is to reduce hundreds of rows into a smaller number of high-leverage user decisions.

## Goals

- Efficiently and correctly categorize an initial or backlog set of uncategorized transactions.
- Use group-level confirmation for uncertain or high-impact transaction groups.
- Reuse the existing Ask Penge chat assistant and its explicit-confirmation write semantics.
- Keep background auto-categorization separate and non-interactive.
- Use virtual filesystem workspace files as the assistant's primary working context during bulk categorization.
- Avoid repeated exploratory database reads over the same transaction set.
- Keep the database as source of truth and final writes guarded by existing domain validation.
- Support normal personal-finance backlog sizes, roughly up to 500 transactions, before adding pagination.

## Non-goals

- Solving imports larger than about 500 transactions in the first version.
- Adding cursor pagination in the first version.
- Creating a separate bulk categorization agent or new product surface.
- Replacing the existing autonomous categorization workflow.
- Letting the model write directly to domain tables.
- Automatically redesigning the user's category system. The assistant may mention category gaps, but the primary task is efficient and correct categorization.
- App-preparing transaction snapshot files before invoking the assistant.

## Product model

Penge should have two distinct AI categorization paths:

| Path | Interaction model | Primary use | Confirmation behavior |
| --- | --- | --- | --- |
| Background auto-categorization workflow | Autonomous workflow | New transactions after bank sync | No user questions; apply only when sufficiently grounded |
| Interactive bulk categorization chat | Ask Penge chat assistant | Initial imports and large backlogs | Ask group-level confirmation questions before uncertain/high-impact writes |

The existing `categorize-transactions` workflow remains suitable for eventual background operation after bank sync. Interactive bulk categorization belongs in chat because chat can ask questions, receive natural confirmation, and apply user-confirmed writes.

## User experience

A user can start the mode through a prompt or UI shortcut such as:

> Help me bulk categorize my uncategorized transactions.

The assistant should then:

1. Read eligible uncategorized or needs-review transactions and valid categories.
2. Build workspace files for transactions, groups, decisions, and progress.
3. Group similar transactions by merchant, counterparty, recurrence, amount pattern, transfer candidates, and description similarity.
4. Identify confident groups that can be proposed for efficient bulk confirmation.
5. Ask concise group-level confirmation questions for groups before applying writes.
6. Apply confirmed decisions through the existing chat `applyCategorization` tool.
7. Report progress and move to the next useful group.

Example assistant question:

> I found 23 transactions from Rema 1000, Netto, and Føtex, mostly between 40 and 900 DKK. These look like grocery purchases. Should I categorize them as Groceries? Examples: Netto 245 DKK, Rema 1000 381 DKK, Føtex 92 DKK.

The user can answer:

- `yes` / `go ahead` — apply the proposed group decision.
- `use Household instead` — refine the group decision, state the revised proposal, and ask for confirmation if needed before writing.
- `no` — leave the group unresolved or ask a follow-up.
- `split Netto as Groceries and Føtex as Household` — refine the grouping before proposing writes.

## Assistant behavior

### Bulk mode trigger

The current team data assistant should recognize explicit requests such as:

- “bulk categorize my uncategorized transactions”
- “help me categorize the backlog”
- “categorize my initial import”
- “review uncategorized transactions in groups”

A UI shortcut may send a stronger initial instruction to start this mode, but the durable behavior should live in assistant instructions or a Flue skill so it is not dependent on one long ad-hoc prompt.

### Workspace-driven rule

The core rule for the mode is:

> For large categorization runs, use the virtual filesystem as the source of working context: ingest scoped DB results once, maintain JSONL/JSON files for transactions, groups, decisions, and progress, and avoid repeated DB searches except for refreshes, conflicts, missing data, or final guarded writes. Prepare confident group-level proposals where possible, and ask the user to confirm the group-level mapping before applying guarded writes.

This is stronger than “build context files first.” The assistant should continue using the files as its working substrate for grouping, comparing, decision tracking, and progress across turns.

### Workspace files

The assistant should create files with names like:

```txt
/work/bulk-categorization/categories.json
/work/bulk-categorization/eligible-transactions.jsonl
/work/bulk-categorization/merchant-groups.jsonl
/work/bulk-categorization/recurring-groups.jsonl
/work/bulk-categorization/transfer-candidates.jsonl
/work/bulk-categorization/category-decisions.jsonl
/work/bulk-categorization/progress.json
```

Suggested file purposes:

- `categories.json`: valid category choices, including category name, group, type, and description.
- `eligible-transactions.jsonl`: compact scoped transaction rows, including internal id, date, amount, currency, description, counterparty, bank account, review status, current interpretation summary, categorization revision, and `canWrite`.
- `merchant-groups.jsonl`: normalized merchant/counterparty clusters with transaction counts, representative examples, candidate category, and confidence/uncertainty notes.
- `recurring-groups.jsonl`: repeating payments or income patterns.
- `transfer-candidates.jsonl`: likely internal transfers, where supported by available transaction evidence.
- `category-decisions.jsonl`: proposed, confirmed, rejected, or applied group decisions.
- `progress.json`: current phase, completed groups, applied counts, unresolved counts, and any conflicts requiring refresh.

Files are working memory, not authority. The assistant must not expose internal ids in normal chat responses.

### Database reads

The first version can raise the read-tool maximum limit from 100 to about 500. Pagination is intentionally deferred.

The assistant should read scoped data into files near the start of bulk mode and avoid repeatedly searching the same data set. Follow-up DB reads are appropriate when:

- the workspace lacks required detail;
- a write returns a stale `categorizationRevision` conflict;
- the user asks about data outside the current workspace;
- the assistant needs to refresh a row before retrying;
- the assistant is about to apply a final guarded write and needs current detail.

### Writes and confirmation

Interactive bulk categorization uses the existing chat write semantics:

- The assistant must state a concrete proposal before any write.
- The initial bulk-categorization request is not permission to write every discovered change.
- The assistant must wait for a separate natural confirmation of the latest proposal before calling `applyCategorization`.
- The proposal may be group-level, as long as it clearly names the user-facing transaction pattern, category, count, and representative examples.
- Writes still use manual user-confirmed semantics and require current `categorizationRevision` values.
- If a write conflicts or is rejected, the assistant reports the issue, refreshes relevant data, updates workspace progress, and does not blindly replay stale writes.

The existing `applyCategorization` tool applies one transaction at a time. That is acceptable for the first version. A future bulk-apply tool may be useful if group application becomes too slow or tool-call heavy.

## Data and safety boundaries

- The browser never receives the internal Flue token.
- The web `/api/flue` proxy and Flue agent route continue to validate trusted user/team scope.
- The model never supplies user id or team id.
- Read tools remain scoped to the trusted team and expose compact projections, not raw provider payloads.
- Final writes go through existing guarded domain services.
- The database remains the source of truth.
- Workspace files may contain internal ids for tool calls, but normal chat responses must use user-facing names, dates, amounts, descriptions, and summaries.
- Stale workspace data is handled through `categorizationRevision` conflicts and targeted refreshes.

## Relationship to existing auto-categorization workflow

The autonomous `categorize-transactions` workflow should remain non-interactive. It should not ask user questions and should stay suitable for future background bank-sync use.

Bulk chat mode may share read/write tools with the workflow, but its behavior is different:

- it can ask questions;
- it can wait for user confirmation;
- it can use a longer-lived conversational workspace;
- it optimizes for correct group decisions rather than silent automation.

## Settled design decisions

- Use Flue's default virtual sandbox for the workspace. The assistant should work under a predictable cwd such as `/workspace`. No app-prepared snapshot files or custom file tools are part of the first design; if implementation testing shows the assistant lacks usable file access, configure the existing virtual sandbox capabilities rather than changing the product model.
- Use a stronger model for bulk mode, ideally matching the autonomous categorization workflow's `openai/gpt-5.4-mini`. Bulk grouping and user-facing proposals require stronger reasoning than the default lightweight chat model.
- Enter workspace bulk mode whenever the user explicitly asks for bulk/backlog/initial categorization. The assistant may also choose workspace mode when it finds roughly 50 or more eligible transactions. Smaller sets can use the normal chat/tool flow.
- Confirmed group decisions apply to the current backlog/session only. Do not create durable merchant/category rules in the first version.
- Progress is surfaced through chat summaries only. A dedicated progress UI is deferred.

## Implementation considerations

This spec is intentionally not an implementation plan, but the design has a few likely code-level implications:

- `searchBankTransactions` currently caps results at 100 through the shared read projection limit. The first version should raise this cap to around 500 for assistant bulk mode.
- The team data assistant instructions should gain a durable “bulk categorization mode” section, or Flue should provide the behavior as a skill if that is the preferred mechanism.
- If one-by-one `applyCategorization` calls are too slow for confirmed groups, consider a later guarded bulk categorization write tool. That is not required for the first validation slice.

## Testing and validation

Validation should focus on behavior rather than only code paths:

- A seeded backlog of roughly 100–300 uncategorized transactions can be ingested into workspace files.
- The assistant creates meaningful merchant/recurring/transfer groups.
- The assistant asks concise group-level confirmation questions for uncertain groups.
- The assistant does not write after the initial request alone.
- After explicit user confirmation, the assistant applies the confirmed group through guarded categorization writes.
- Rejected or stale writes cause refresh/update behavior, not blind retries.
- User-facing chat output does not expose internal ids.
- The autonomous workflow remains non-interactive and unchanged in product semantics.

## Deferred work

- Cursor pagination for 500+ transaction backlogs.
- App-side prebuilt snapshot files.
- Separate dedicated bulk categorization agent.
- Dedicated UI wizard or progress UI for bulk categorization.
- Guarded bulk-apply write tool.
- Persistent reusable merchant rules generated from confirmed group decisions.
- Category-system redesign or onboarding category setup.
