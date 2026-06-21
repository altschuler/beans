# Bank-Transaction-First Categorization Cleanup Design

## Status

Draft for review on 2026-06-21. This spec is a cleanup/refactor spec, not a new product feature. It follows the current product direction that normal transaction actions and AI categorization operate on imported bank transactions, while ledger transactions and postings are internal interpretations.

## Summary

Simplify ledger categorization by making `bankTransactionId` the single command identity for normal imported-transaction interpretation flows.

The current implementation has partially moved to this model: Zero mutators and UI categorization/split actions already target bank transaction ids, and AI server functions request bank transaction ids. However, `src/ledger/categorization.server.ts` and `src/ledger/ai-categorization.server.ts` still preserve a legacy ledger-transaction-first path. AI application still chooses between updating an existing ledger transaction by `ledgerTransactionId` and creating/replacing an interpretation by `bankTransactionId`. This keeps old complexity alive and makes the categorization server look larger than the domain now requires.

The cleanup should introduce one bank-transaction-first interpretation command and make category, split, transfer, and AI application use it. The target public surface should also move confirmation to `bankTransactionId`, because confirmation is a transaction-row action even though it updates ledger transaction metadata. Existing ledger transaction/posting rows should be treated as replaceable internal interpretations of imported bank evidence, except where user confirmation/race-safety deliberately prevents AI from overwriting a newer confirmed interpretation.

## Source documents and investigated files

Source-of-truth docs read for this spec:

- `docs/ACCOUNTING_MODEL.md`
- `docs/ARCHITECTURE.md`
- `docs/DATABASE.md`
- `docs/SERVER.md`
- `docs/PLANS.md`

Current implementation files investigated:

- `src/ledger/categorization.server.ts`
- `src/ledger/ai-categorization.server.ts`
- `src/ledger/ai-categorization-fns.ts`
- `src/ledger/ai-categorization-fns.server.ts`
- `src/zero/mutators.ts`
- `src/zero/mutators.server.ts`
- `src/components/ledger/ledger-dashboard.tsx`
- `src/components/ledger/ledger-dashboard-model.ts`
- `src/components/transaction-table/transaction-table.tsx`
- `src/components/transaction-table/transaction-row.tsx`
- `src/components/transaction-table/types.ts`
- `src/ledger/similar-categorization-examples.server.ts`
- `src/zero/queries.ts`
- relevant ledger/bank relations in `src/db/schema.ts`
- `tests/unit/ledger-categorization-server.test.ts`
- `tests/unit/ledger-ai-categorization-server.test.ts`
- `tests/unit/ledger-ai-categorization-fns.test.ts`
- `tests/unit/zero-mutators.test.ts`
- `tests/unit/ledger-dashboard.test.ts`
- `tests/unit/ledger-dashboard-model.test.ts`
- `src/components/ledger/ledger-dashboard-model.test.ts`

## Current state

### What is already bank-transaction-first

The UI and mutator input shape have already moved away from ledger-transaction-first categorization:

- `mutators.ledger.categorizeTransaction` accepts `{bankTransactionId, selection}`.
- `mutators.ledger.splitTransaction` accepts `{bankTransactionId, lines}`.
- `LedgerDashboard` calls `mutators.ledger.categorizeTransaction({bankTransactionId, selection})`.
- `LedgerDashboard` calls `aiCategorizeTransaction({data: {bankTransactionId}})`.
- `TransactionTable` and `TransactionRow` pass `bankTransactionId` for categorization, split, and AI categorization.
- `ai-categorization-fns.server.ts` accepts a single `bankTransactionId` and forwards `bankTransactionIds` to the AI categorization service.

### Legacy ledger-transaction-first remnants

The main remaining legacy path is server-side:

- `src/ledger/ai-categorization.server.ts` still imports both `categorizeBankTransaction` and `categorizeLedgerTransaction`.
- `applyAiCategorizationSuggestions` loads `currentTransaction.ledgerTransactionId` and chooses:
  - `categorizeLedgerTransaction(...)` when an interpretation already exists;
  - `categorizeBankTransaction(...)` when no interpretation exists.
- `categorizeLedgerTransaction(...)` is not used by non-test production code except that AI branch.
- `categorizeLedgerTransaction(...)` contains complexity for preserving the existing ledger transaction id and bank posting id while replacing only non-reconciled postings.
- That preservation behavior is inconsistent with the user-facing bank transaction mutator path, where `categorizeBankTransaction(...)` deletes any existing ledger interpretation for that bank transaction and creates a replacement interpretation.

`confirmLedgerTransaction(...)` is still ledger-transaction-id based. Confirmation is separate from applying a new interpretation, but it still leaks internal ledger identity into the transaction table and Zero mutator API. It also reuses the exact-one-reconciled-posting loader, which does not fit imported transfers that can legitimately have two bank-linked postings in one ledger transaction.

### Why the file is large

`categorization.server.ts` is large because it contains multiple responsibility axes in one place:

1. bank transaction authorization/loading;
2. existing interpretation deletion/replacement;
3. category/split posting construction;
4. imported-account transfer matching;
5. ledger-transaction-first category replacement;
6. user confirmation;
7. clear-all reset;
8. AI metadata persistence;
9. reconciliation invariant loading/validation.

Extracting small helpers would reduce local repetition, but the bigger simplification is removing the now-unneeded ledger-transaction-first categorization path from the active AI flow.

## Goals

- Make normal imported transaction interpretation writes target `bankTransactionId`.
- Make normal imported transaction confirmation target `bankTransactionId` in the target architecture.
- Make AI application always apply suggestions through the same bank-transaction-first interpretation command as manual categorization.
- Preserve existing user-facing behavior for category, split, transfer, AI confidence, AI reasoning, processing markers, and confirmation indicators.
- Preserve race-safety: AI must not overwrite a transaction that became confirmed after the model input was loaded.
- Reduce `src/ledger/categorization.server.ts` by removing or quarantining the active `categorizeLedgerTransaction(...)` path.
- Keep external orchestration boundaries intact: AI remains a server function/service, not a Zero mutator.
- Keep Zero mutators short and user-facing domain writes Zero-backed.

## Non-goals

This cleanup does not add:

- new categorization UI;
- new transfer UI;
- manual transaction entry;
- durable AI jobs or background workers;
- production data migration;
- audit history for replaced ledger interpretations;
- changes to similar-example ranking semantics;
- a broad rewrite of ledger posting domain helpers.

This cleanup should not resolve the broader product question of whether imports should eagerly create Uncategorized ledger interpretations or remain unreconciled until a user/AI action. The implementation must continue to handle both current shapes: a bank transaction with no ledger interpretation and a bank transaction with an existing needs-review ledger interpretation.

## Proposed architecture

### One internal interpretation command

Introduce one internal command that applies an interpretation to an imported bank transaction:

```ts
type ApplyBankTransactionInterpretationInput = {
  userId: string
  bankTransactionId: string
  interpretation:
    | {kind: 'category'; accountId: string}
    | {kind: 'split'; lines: CategorizationLineInput[]}
    | {kind: 'transfer'; accountId: string}
  status?: 'confirmed' | 'needs_review'
  categorizedBy?: 'user' | 'ai'
  aiConfidence?: 0 | 1 | 2 | null
  aiReasoning?: string | null
  requiredExistingStatus?: 'confirmed' | 'needs_review'
}
```

Expected behavior:

1. Authorize and lock the bank transaction by `bankTransactionId` and team membership.
2. Load the bank-linked ledger account for the bank transaction's bank account.
3. Load the current ledger interpretation, if any, through `ledger_postings.bank_transaction_id = bankTransactionId`.
4. If `requiredExistingStatus` is present and an interpretation exists with a different status, return `false` without changing postings or AI result metadata.
5. For manual writes, reject if `bankTransactions.aiProcessingStartedAt` is fresh.
6. Validate category/split/transfer inputs against same-team active accounts.
7. Delete the current ledger interpretation for this bank transaction if one exists.
8. Build the replacement ledger transaction and postings.
9. Insert the replacement interpretation.
10. Validate zero-sum persisted postings.
11. Persist AI result metadata when `categorizedBy === 'ai'`; otherwise clear stale AI metadata.
12. Return `true` when a replacement was applied.

The command may initially stay private inside `categorization.server.ts`. Public exports can remain wrappers until callers and tests are migrated.

### Thin public wrappers

Keep the existing user-facing public exports as compatibility wrappers around the new command:

```ts
export async function categorizeBankTransaction(tx, input) {
  return applyBankTransactionInterpretation(tx, {
    userId: input.userId,
    bankTransactionId: input.bankTransactionId,
    interpretation: input.selection,
    status: input.status,
    categorizedBy: input.categorizedBy,
    aiConfidence: input.aiConfidence,
    aiReasoning: input.aiReasoning,
  })
}

export async function splitBankTransaction(tx, input) {
  return applyBankTransactionInterpretation(tx, {
    userId: input.userId,
    bankTransactionId: input.bankTransactionId,
    interpretation: {kind: 'split', lines: input.lines},
  })
}
```

This keeps Zero mutator call sites stable while removing duplicate implementation flow.

### AI always applies by bank transaction id

`applyAiCategorizationSuggestions` should no longer branch on `currentTransaction.ledgerTransactionId`.

For confidence `1` and `2`, it should call the bank-transaction-first command:

```ts
const didApply = await applyBankTransactionInterpretation(tx, {
  userId,
  bankTransactionId: suggestion.bankTransactionId,
  interpretation: {kind: 'category', accountId: suggestion.categoryAccountId},
  status: suggestion.confidence === 2 ? 'confirmed' : 'needs_review',
  categorizedBy: 'ai',
  aiConfidence: suggestion.confidence,
  aiReasoning: suggestion.reasoning,
  requiredExistingStatus: 'needs_review',
})
```

The `requiredExistingStatus: 'needs_review'` guard preserves the important stale-result behavior from `categorizeLedgerTransaction(..., requiredCurrentStatus: 'needs_review')`: if a user confirms or recategorizes the transaction after the model call but before suggestion application, AI should skip rather than overwrite that newer result.

For a bank transaction with no current ledger interpretation, `requiredExistingStatus` should not block application. This keeps AI able to categorize lazy/unreconciled imported bank transactions.

Confidence `0` should continue to record `aiConfidence = 0` and normalized `aiReasoning` on `bank_transactions` without creating or replacing a ledger interpretation.

### Rename AI service for clarity

The exported AI service name `aiCategorizeLedgerTransactions` is now misleading. Rename it to `aiCategorizeBankTransactions` and keep a temporary compatibility alias only if needed by tests or nearby call sites.

Preferred final shape:

```ts
export async function aiCategorizeBankTransactions(input, categorizeWithModel = categorizeWithOpenAI) { ... }
```

Then update:

- `ai-categorization-fns.server.ts`
- `tests/unit/ledger-ai-categorization-server.test.ts`
- `tests/unit/ledger-ai-categorization-fns.test.ts`

A compatibility export can remain during the first implementation pass:

```ts
export const aiCategorizeLedgerTransactions = aiCategorizeBankTransactions
```

Remove it in the same change if all imports are updated and no external code depends on it.

### Reassess `categorizeLedgerTransaction`

After AI stops using `categorizeLedgerTransaction`, production source references should be limited to its own definition. At that point:

- delete `categorizeLedgerTransaction` if no real caller remains; or
- move it to a clearly legacy/test-only path only if a near-term implementation plan needs it temporarily.

The preferred outcome is deletion. Its tests should be rewritten to exercise equivalent behavior through bank transaction ids:

- replacing an existing needs-review interpretation;
- preserving bank transaction facts;
- replacing non-reconciled category postings;
- rejecting invalid category accounts;
- handling positive bank amounts;
- split total validation;
- stale AI application guard.

### Confirmation

The target design should replace ledger-id confirmation with bank-id confirmation:

```ts
confirmBankTransactionInterpretation(tx, {userId, bankTransactionId})
```

That command should load the current interpretation through `ledger_postings.bank_transaction_id = bankTransactionId`, validate the reconciled posting invariant for that specific bank transaction, validate confirmable non-reconciled category postings, and set user confirmation fields on the parent ledger transaction.

This can be implemented as a separate milestone from AI cleanup if needed, but it belongs in the same strategic cleanup because otherwise the UI and Zero mutator surface remain partly ledger-transaction-first.

Transfer semantics need an explicit rule: a transfer ledger transaction has two bank-linked postings and no category posting. The existing category-confirmation rules should not be blindly applied to transfers. The implementation should either leave transfer confirmation out of scope for the first confirm-by-bank pass or define transfer confirmation as confirming the shared transfer interpretation without requiring a real category posting.

## Detailed behavior

### Manual category

Manual category selection should:

- target `bankTransactionId`;
- reject if the bank transaction is currently being categorized by fresh AI processing;
- allow overwriting existing needs-review or confirmed interpretations;
- delete an existing transfer/category/split interpretation for that bank transaction;
- create a new bank-import ledger transaction with:
  - one bank-linked posting matching the bank transaction amount/currency/account;
  - one category posting for the selected account with the opposite sign;
- set ledger transaction `status = 'confirmed'` by default;
- set `categorizedBy = 'user'` by default;
- set `userConfirmedAt` and `userConfirmedBy`;
- clear stale bank transaction AI confidence/reasoning/processing fields.

### Manual split

Manual split should:

- target `bankTransactionId`;
- reject if fresh AI processing is active;
- validate all line accounts as real categorization accounts;
- validate positive split amounts;
- validate split total equals absolute bank transaction amount;
- replace any existing interpretation;
- set user confirmation metadata as a manual confirmed interpretation;
- clear stale AI metadata.

### Transfer

Transfer selection should remain an interpretation kind, not a category subtype.

Transfer should:

- target source `bankTransactionId`;
- validate the selected target ledger account is an active same-team bank-linked account;
- reject transfer to the same linked bank account;
- find an unmatched opposite bank transaction on the target linked bank account with same currency and amount within the existing date window;
- delete any existing interpretations for the source bank transaction before writing the transfer;
- write one ledger transaction with two reconciled bank postings;
- clear source bank transaction AI metadata.

The transfer matching/date-window helpers may stay in `categorization.server.ts` during the first pass. Moving them to a dedicated module is a follow-up cleanup after the command identity is simplified.

### AI category application

AI category application should:

- request and model bank transactions, not ledger transactions;
- keep using `bankTransactions.aiProcessingStartedAt` for processing claims;
- skip suggestions whose bank transaction id is not in the claimed work set;
- skip suggestions whose category id is missing or cross-team;
- process at most one suggestion per bank transaction;
- for confidence `0`, record AI failure metadata on the bank transaction only;
- for confidence `1`, apply the category and leave the replacement ledger transaction `needs_review`;
- for confidence `2`, apply the category and mark the replacement ledger transaction `confirmed`;
- set `categorizedBy = 'ai'` for applied AI categories;
- leave `userConfirmedAt` and `userConfirmedBy` null for AI-applied categories;
- not overwrite an existing interpretation that is no longer `needs_review` at application time;
- clear only the processing marker from this AI run in the `finally` path.

### Existing interpretation replacement

The cleanup should intentionally accept that applying a category/split/transfer by bank transaction id replaces the current ledger transaction row rather than preserving its id. This matches existing manual bank-transaction categorization behavior.

This means tests should stop asserting that AI categorization necessarily preserves `ledger-transaction-1`. They should instead assert through the bank transaction's current reconciled posting:

1. select `ledgerPostings` by `bankTransactionId`;
2. read `ledgerTransactionId` from that posting;
3. assert the replacement ledger transaction metadata and postings.

### Multi-reconciled transfer interpretations

When replacing one side of a matched transfer, deleting the current ledger interpretation detaches the counter bank transaction too. Existing tests already expect this for manual recategorization. The bank-transaction-first command should preserve that behavior.

AI should generally not rewrite confirmed transfers because of the `requiredExistingStatus: 'needs_review'` guard. If a transfer interpretation is still `needs_review`, AI may replace the source bank transaction's interpretation with a category, matching current manual replacement semantics.

## Error handling and authorization

- Authorization remains server-side and based on team membership through the bank transaction's bank account.
- Category account validation remains same-team and uses real categorization account rules.
- Transfer target validation remains same-team, active, bank-linked account rules.
- Known domain errors can keep their current messages.
- Unknown errors should continue to be surfaced through existing UI `showErrorToast` paths.
- AI reasoning remains required and normalized for AI-applied categories and confidence-0 records.
- Stale AI processing timestamps should not block future AI attempts.

## File responsibilities after cleanup

### `src/ledger/categorization.server.ts`

Primary server-only imported transaction interpretation service.

Expected contents after the first pass:

- `categorizeBankTransaction` wrapper;
- `splitBankTransaction` wrapper;
- internal `applyBankTransactionInterpretation` command;
- bank transaction loading/locking;
- existing interpretation lookup/deletion;
- category/split/transfer posting construction orchestration;
- confirmation and clear-all commands, unless moved later;
- AI metadata finish helpers.

Expected removal or reduction:

- active `categorizeLedgerTransaction` path;
- duplicate category vs split creation flow;
- AI-specific ledger-transaction status compare-and-set code.

### `src/ledger/ai-categorization.server.ts`

AI orchestration service.

Expected changes:

- import only the bank-transaction-first interpretation command/wrapper;
- remove `categorizeLedgerTransaction` import;
- remove `currentTransaction.ledgerTransactionId ? ... : ...` application branch;
- rename `aiCategorizeLedgerTransactions` to `aiCategorizeBankTransactions` or add a compatibility alias;
- keep model input/output using bank transaction ids.

### `src/ledger/ai-categorization-fns.server.ts`

Server function handler wrapper.

Expected changes:

- call `aiCategorizeBankTransactions`;
- keep public server function inputs using `bankTransactionId` and `limit`.

### `src/zero/mutators.ts` and `src/zero/mutators.server.ts`

Category and split inputs are already bank-transaction-first and should stay stable.

Expected confirmation changes in the target architecture:

- change `confirmTransactionInput` from `{ledgerTransactionId}` to `{bankTransactionId}`;
- call `confirmBankTransactionInterpretation` on the server;
- update UI callback names and tests to stop passing ledger transaction ids for confirmation.

### Tests

Tests should shift from asserting internal ledger transaction identity to asserting current interpretation via `ledger_postings.bank_transaction_id`.

## Testing strategy

### Focused server categorization tests

Update `tests/unit/ledger-categorization-server.test.ts` to cover bank-transaction-first behavior:

- categorizing an unreconciled bank transaction creates a balanced interpretation;
- categorizing an already interpreted bank transaction replaces the old interpretation;
- splitting an already interpreted bank transaction replaces the old interpretation;
- transfer creation still matches the exact opposite bank transaction;
- recategorizing one side of a matched transfer still detaches the old counter side;
- invalid category accounts are rejected through bank transaction commands;
- positive bank amounts produce opposite-sign category postings;
- AI-style application with `requiredExistingStatus: 'needs_review'` returns `false` and changes nothing if the existing interpretation is already `confirmed`;
- AI-style application with no existing interpretation is allowed.

Remove or rewrite tests whose only purpose is direct `categorizeLedgerTransaction(...)` coverage.

### Focused AI tests

Update `tests/unit/ledger-ai-categorization-server.test.ts`:

- rename imports/calls from `aiCategorizeLedgerTransactions` to `aiCategorizeBankTransactions` if the service is renamed;
- assert AI category application through the reconciled bank posting, not a fixed ledger transaction id;
- keep confidence `0` behavior unchanged;
- keep stale-result test: if the interpretation becomes confirmed during the model call, AI skips and does not overwrite it;
- add or keep a test where an existing needs-review interpretation is replaced through the bank transaction path;
- add or keep a test where an unreconciled bank transaction gets a new AI interpretation;
- keep processing marker failure/concurrency tests.

### Mutator and UI tests

Existing Zero mutator category/split tests should mostly stay stable. If confirmation remains ledger-transaction-id based, no mutator schema change is required.

Dashboard tests should continue to assert:

- AI single-row action passes `bankTransactionId`;
- category selection passes `bankTransactionId`;
- confirmation passes `bankTransactionId` in the target architecture;
- confirmation remains available only when a ledger interpretation exists;
- rows still derive display state from bank transaction plus current reconciled posting.

Similar-example tests can keep `ledgerTransactionId` as provenance for examples, but target transaction ids and suggestions should remain bank-transaction ids. If the model does not need ledger ids in examples, a later naming cleanup can add `bankTransactionId` or rename the field to `sourceLedgerTransactionId` to make provenance explicit.

### Verification commands

Focused verification for implementation:

```bash
pnpm vitest run tests/unit/ledger-categorization-server.test.ts tests/unit/ledger-ai-categorization-server.test.ts tests/unit/ledger-ai-categorization-fns.test.ts tests/unit/zero-mutators.test.ts
```

Broader regression checks before completion:

```bash
pnpm vitest run tests/unit/ledger-dashboard-model.test.ts src/components/ledger/ledger-dashboard-model.test.ts tests/unit/ledger-dashboard.test.ts
pnpm typecheck
pnpm build
```

## Migration and rollout plan

1. Add the bank-transaction-first internal interpretation command behind existing exports.
2. Rewrite `categorizeBankTransaction` and `splitBankTransaction` to use it.
3. Add the AI stale-status guard to the bank-transaction-first command.
4. Change AI application to always call the bank-transaction-first command.
5. Update AI tests to assert via current bank posting rather than fixed ledger transaction ids.
6. Rename the AI service from ledger transactions to bank transactions, with or without a temporary alias.
7. Add bank-transaction-first confirmation and update the Zero/UI confirm surface, or explicitly split this into the next implementation plan milestone if the transfer confirmation decision blocks it.
8. Remove `categorizeLedgerTransaction` and its direct tests once no production caller remains.
9. Run focused and broader regression tests.

## Risks and mitigations

### Risk: AI overwrites user-confirmed work

Mitigation: preserve `requiredExistingStatus: 'needs_review'` semantics in the bank-transaction-first command. Existing interpretation status must be checked inside the same database transaction as deletion/replacement.

### Risk: Tests depend on stable ledger transaction ids

Mitigation: update tests to query by `ledgerPostings.bankTransactionId` first. Stable ledger transaction ids are an implementation detail of the old path and should not be part of user-facing behavior.

### Risk: Transfer replacement detaches counter-side interpretations unexpectedly

Mitigation: preserve current tested behavior. When one side of a matched transfer is replaced, deleting the shared ledger transaction detaches the counter bank transaction. This should remain explicit in tests.

### Risk: Naming churn creates partial aliases

Mitigation: rename `aiCategorizeLedgerTransactions` in one focused pass. If a compatibility alias is kept, mark it temporary in code and remove it before the cleanup is considered complete.

### Risk: server-only import boundary regressions

Mitigation: keep `import '@tanstack/react-start/server-only'` at the top of server modules. Run `pnpm build` after refactoring because TanStack import-boundary issues can be build-only.

## Open decisions

1. What are the exact confirmation semantics for transfer interpretations? Recommendation: do not require real category postings for transfers; either hide confirmation for transfer rows or confirm the shared transfer interpretation by bank transaction id.
2. Should bank-transaction-first confirmation be implemented in the first cleanup milestone or the next one? Recommendation: include it if transfer confirmation is decided; otherwise complete AI/category/split cleanup first and leave confirmation as the only documented ledger-id exception.
3. Should the AI service keep a compatibility export named `aiCategorizeLedgerTransactions` for one release? Recommendation: remove it in the same branch if all source/test imports are updated.
4. Should transfer matching move to a separate module in the same cleanup? Recommendation: defer until after the bank-transaction-first command is in place, because otherwise the split hides the main conceptual cleanup.
