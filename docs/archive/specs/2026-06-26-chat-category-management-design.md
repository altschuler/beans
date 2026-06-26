# Chat category management design

## Summary

Give Penge's team data assistant the ability to manage category groups and categories, where product categories are editable ledger accounts. The assistant may create, update, and delete category groups and categories only after the current chat user explicitly confirms a concrete proposal. The feature reuses the same domain rules as the existing category management page.

## Goals

- Let users ask chat to create, rename, move, edit, and delete category groups and categories.
- Preserve existing category management invariants and authorization checks.
- Require explicit confirmation before every write, matching the existing transaction-categorization chat safety model.
- Keep one authoritative implementation of category/group write rules shared by web Zero mutators and Flue tools.

## Non-goals

- Batch writes in a single tool call.
- Archiving/deactivating categories with history.
- Letting the model choose user, team, or arbitrary database scope.
- Editing bank-linked ledger accounts or system accounts.

## Architecture

Move reusable category/group write logic into `packages/domain/src/category-management.ts`. The shared module owns authorization, validation, trimming, delete eligibility, and sort-order behavior.

The existing web module `apps/web/src/ledger/category-management.server.ts` should become a thin server-only wrapper or re-export around the shared domain functions so existing Zero mutators keep their public shape.

Add a Flue chat category-management tool in `apps/flue/src/agent-tools/write-tools.ts`. The tool receives trusted `userId` and `teamId` from the decoded team data assistant scope. The model cannot provide or override those values. The assistant config includes the new tool alongside the existing read tools and confirmed transaction-categorization write tool.

## Data flow

1. The assistant uses read tools, especially `searchLedgerAccounts`, to inspect current category groups and categories.
2. The assistant states a concrete proposal that names the exact group/category and the exact operation.
3. The assistant waits for explicit confirmation of the latest proposal.
4. The assistant calls the category-management tool once per operation.
5. The tool runs the shared domain write in a database transaction and returns a structured result.
6. If a write fails, the assistant reports the failure and re-reads before proposing a follow-up.

## Supported operations

The tool supports exactly one operation per call:

- `createGroup`: create an editable category group for the trusted team.
- `updateGroup`: rename an editable category group.
- `deleteGroup`: delete an editable empty category group.
- `createCategory`: create an editable category account in an editable group.
- `updateCategory`: update category name, description, type, and group.
- `deleteCategory`: delete an editable category account with no ledger postings.

A user may confirm a multi-step proposal such as creating a group and two categories. The assistant may then execute that as several one-operation tool calls, stopping and reporting if any operation fails.

## Guardrails and validation

The shared domain logic enforces the existing category management rules:

- user must be a member of the trusted team
- names are trimmed and non-empty
- category type must be `expense`, `income`, or `savings`
- categories can only be created or moved into editable non-system groups
- system groups cannot be edited or deleted
- system accounts cannot be edited or deleted
- bank-linked accounts cannot be edited or deleted as categories
- groups containing accounts cannot be deleted
- categories with ledger postings cannot be deleted
- duplicate-name database constraints reject conflicting names without partial writes

The assistant instructions must remove the old limitation that chat cannot manage categories, and replace it with confirmation-specific rules:

- before any category/group write, state the latest concrete proposal
- wait for natural explicit confirmation such as “yes”, “sounds good”, or “go ahead”
- do not treat a new unrelated request as confirmation
- do not write when evidence is insufficient

## Error handling

The tool returns structured JSON suitable for the assistant to explain:

- `{ok: true, status: "applied"}` for success
- `{ok: false, status: "rejected", error: "..."}` for validation, authorization, database constraint, or delete-eligibility failures

No partial writes should be committed for a single operation. For multi-operation user proposals, each operation is independently committed; if one fails, the assistant reports the failure and does not continue blindly.

## Testing

Test meaningful boundaries rather than implementation plumbing:

- shared domain category management permits valid create/update/delete operations
- shared domain category management rejects locked groups/accounts, bank-linked accounts, non-empty group deletion, and category deletion with postings
- Flue tool uses trusted scope and has no user/team input fields
- Flue tool performs one operation per call and returns structured rejected results on failures
- team data assistant config includes the category-management tool
- team data assistant instructions require confirmation and no longer say category editing is unavailable

Run focused unit tests for changed packages and `just check` after implementation.
