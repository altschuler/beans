# Canonical Ledger Postings Refactor Design

## Status

Draft revised for review on 2026-06-20. This spec is intentionally limited to the accounting data model refactor. Manual account onboarding, account-kind setup flows, and new account-management UI are deferred until after this foundation is in place.

This spec supersedes the clearing-account transfer modeling direction in `docs/specs/2026-06-19-bank-transfer-categorization-design.md`. Transfer UI remains out of scope for this refactor, but the data model should support a later direct two-posting imported transfer match.

## Summary

Replace the current `ledger_transaction_movements` model with canonical signed ledger postings.

Today each movement row stores a debit account, credit account, and positive amount. Imported bank transactions link to the whole ledger transaction, so the system must infer which side of the movement reconciles the bank transaction. That works for simple imports, but it becomes awkward for splits, transfers, and future manual bank-like accounts.

The new model stores one signed posting per account per ledger transaction. Imported bank transactions reconcile exact postings rather than whole transactions. This makes reconciliation explicit and gives the ledger a standard zero-sum shape:

```txt
ledger transaction T1
  Checking    -100 DKK   reconciles imported bank transaction BT1
  Groceries    100 DKK
```

## Source documents

- `docs/ACCOUNTING_MODEL.md` defines the desired accounting model and examples.
- `docs/ARCHITECTURE.md` defines Zero-backed app data read/write boundaries.
- `docs/DATABASE.md` defines Drizzle/Zero schema expectations.
- `docs/SERVER.md` defines when to use Zero mutators versus server functions.

## Goals

- Make ledger transactions canonical zero-sum accounting events.
- Make each posting a signed amount on one ledger account.
- Reconcile imported bank transactions to exact bank-account postings.
- Keep imported bank transactions immutable from user-facing ledger actions.
- Keep imported transactions visible immediately by creating balanced Uncategorized ledger transactions on import.
- Preserve existing user-facing categorization behavior: a bank transaction still looks like a transaction with a category or split.
- Keep the implementation ready for later manual account work without implementing that work now.

## Non-goals

This refactor does not add:

- manual account creation
- account-kind onboarding for GoCardless accounts
- `/app/banks/link` or `/app/banks/link/callback`
- manual transaction entry UI
- explicit imported-to-imported transfer UI
- audit history
- production data migration guarantees

The project is still in development, so existing local data and schema can be wiped or regenerated during this refactor.

## Data model

### Bank transactions

`bank_transactions` remain immutable imported source rows. They continue to describe provider facts:

- bank account
- amount
- currency
- dates
- description and counterparty
- raw provider payload

The bank transaction amount uses the provider/bank sign convention already stored today:

- positive amount: money moved into the bank account
- negative amount: money moved out of the bank account

Ledger actions such as categorization, splitting, confirmation, clearing categorization, AI categorization, or transfer matching must not update `bank_transactions` rows.

Provider re-import may update non-reconciliation metadata only when it does not invalidate an existing reconciled posting. `bank_account_id`, provider identity, `amount`, and `currency` are reconciliation facts. If an existing provider transaction is re-imported with a different bank account, amount, or currency after a reconciled posting exists, the import path must not silently update the row and leave the ledger inconsistent. It must either reject that provider update for the row and surface/log a reconciliation problem, or run an explicit repair path that updates the bank transaction and reconciled posting atomically and revalidates the ledger invariants. The initial implementation should prefer rejecting/surfacing factual changes over inventing a repair workflow.

### Ledger transactions

`ledger_transactions` remain the event wrapper for the app's internal accounting interpretation.

A ledger transaction still carries event-level fields such as:

- team
- source
- status
- date
- description
- AI categorization metadata
- user confirmation metadata

`ledger_transactions.bank_transaction_id` is removed. A ledger transaction may have zero, one, or multiple reconciled bank transactions through its postings.

Examples:

- ordinary imported purchase: one reconciled posting
- split imported purchase: one reconciled posting plus multiple category postings
- imported transfer matched between two imported accounts: two reconciled postings
- manual adjustment: no reconciled postings

`source` remains transaction-level. For this refactor, a transaction with at least one reconciled posting is a bank-import ledger transaction. Manual, opening-balance, and budgeting transactions have no reconciled postings.

### Ledger postings

Add `ledger_postings` replacing `ledger_transaction_movements`.

Each posting has:

- id
- ledger transaction id
- account id
- signed amount
- currency
- optional reconciled bank transaction id
- sort order
- timestamps

The bank-transaction-to-posting link is stored as `ledger_postings.bank_transaction_id` with a database uniqueness constraint on non-null values. `bank_transactions` do not store a `reconciledPostingId`, and `ledger_transactions` do not store `bankTransactionId`.

A posting amount is signed:

- positive means debit-side accounting direction
- negative means credit-side accounting direction
- positive and negative do not mean good or bad

A posting may reconcile one imported bank transaction. Reconciled bank transactions are unique: one bank transaction can be linked to at most one posting.

Schema-level expectations:

- `ledger_postings.ledger_transaction_id` references `ledger_transactions.id` with cascade delete.
- `ledger_postings.account_id` references `ledger_accounts.id` with restricted delete.
- `ledger_postings.bank_transaction_id` references `bank_transactions.id` with restricted or cascade behavior chosen deliberately; deleting imported evidence should not leave a silently reconciled posting.
- Index postings by `ledger_transaction_id`, `account_id`, and `bank_transaction_id`.
- Remove legacy `ledger_transaction_movements` and transaction-level bank transaction relations from Drizzle, Zero, generated schema, queries, model types, tests, and repository code.

### Money representation

Money values continue to use `numeric(18,4)` and the existing scaled-unit parsing style. Domain code must compare money by canonical scaled units, not by JavaScript floating point.

Rules:

- Accepted user-entered split amounts are positive decimal values with at most 4 fractional digits.
- Posting amounts may be positive or negative and must be canonicalized to the same 4-decimal scale.
- Negative zero is not valid and must normalize to zero; zero-amount postings should be rejected unless a future explicit workflow requires them.
- Zero-sum validation is per ledger transaction and per currency. Amounts in different currencies must not be coalesced.

## Invariants

The refactor should make these invariants true in repository and mutator code, with focused tests. Database constraints should enforce the parts that are straightforward, and cross-table invariants can be enforced in domain code unless a simple database constraint exists.

1. A ledger transaction has at least two postings after each domain write.
2. Postings for one ledger transaction sum to zero per currency.
3. A posting references exactly one ledger account.
4. A posting may reference at most one imported bank transaction.
5. A bank transaction may be reconciled by at most one posting.
6. If a posting reconciles a bank transaction, its account is the ledger account linked to that bank transaction's bank account.
7. If a posting reconciles a bank transaction, its amount and currency match the bank transaction amount and currency exactly.
8. A ledger account linked to a bank account must belong to the same team as that bank account.
9. Imported bank transactions are not edited by categorization, splitting, confirmation, clearing categorization, AI categorization, or transfer matching.
10. Balances are derived from postings, not stored on accounts.
11. User-facing display rules may invert or reinterpret signed sums by account kind, but underlying postings remain signed zero-sum data.

## Import behavior

When new bank transactions are imported, the app immediately creates a balanced ledger transaction for each imported row that does not already have a reconciled posting.

For an imported Checking transaction of `-100 DKK`, create:

```txt
Checking        -100 DKK   reconciles imported bank transaction
Uncategorized   100 DKK
```

For an imported Checking transaction of `20,000 DKK`, create:

```txt
Checking        20,000 DKK   reconciles imported bank transaction
Uncategorized -20,000 DKK
```

This keeps the ledger balanced at all times and keeps imported rows visible in the review queue.

Import must remain idempotent. Re-importing or updating provider metadata for an existing bank transaction must not create duplicate ledger transactions or duplicate reconciled postings.

Idempotency algorithm:

1. Upsert or load the `bank_transactions` row by provider uniqueness.
2. Before changing reconciliation facts on an existing row, apply the provider-change rule from the Bank transactions section.
3. Look for `ledger_postings.bank_transaction_id = bankTransaction.id`.
4. If a reconciled posting exists, do not create a new ledger transaction.
5. If no reconciled posting exists, create one ledger transaction with two postings: the bank posting linked to the imported bank transaction and the opposite Uncategorized posting.
6. Use the unique constraint on `ledger_postings.bank_transaction_id` as the concurrency backstop. If two imports race, one insert wins; the other catches the uniqueness conflict and reloads the existing reconciled posting.

## Categorization behavior

Categorizing an imported transaction replaces the non-bank, non-reconciled side of the ledger transaction while preserving the reconciled bank posting.

Example before categorization:

```txt
Checking        -100 DKK   reconciles BT1
Uncategorized   100 DKK
```

After categorizing as Groceries:

```txt
Checking    -100 DKK   reconciles BT1
Groceries    100 DKK
```

User-facing imported transaction actions should target the reconciled bank transaction or reconciled posting. If the first implementation keeps a `ledgerTransactionId` input for UI compatibility, the mutator must load exactly one reconciled bank posting for that transaction or reject the action as ambiguous.

Write rules:

- The reconciled bank posting keeps its `bankTransactionId` link and should keep its posting id unless a deliberate repair path is running.
- Categorization replaces only non-reconciled postings for that ledger transaction.
- The category account must belong to the same team.
- The category account must be active.
- Plain categorization must not choose a bank account or a bank-linked ledger account directly; transfer behavior is a separate domain action.
- Plain categorization must not choose system accounts. Uncategorized is allowed for import/clear fallback, but it is not a real confirmed category.
- Real category accounts for categorization are active same-team accounts with no `systemKey`, no `linkedBankAccountId`, and a category-like type such as `income`, `expense`, or `savings`.
- Categorization marks the transaction confirmed for user-initiated categorization.
- AI categorization may still mark transactions confirmed or needs review according to existing AI confidence rules, using the same account eligibility rules.
- The mutator validates posting count, per-currency zero sum, account team ownership, and reconciled-posting invariants before commit.

## Split behavior

Splitting an imported transaction preserves one reconciled bank posting and creates multiple opposite postings.

Example imported `-100 DKK` split between Dentist and Take-away:

```txt
Checking    -100 DKK   reconciles BT1
Dentist       30 DKK
Take-away     70 DKK
```

Rules:

- Split line amounts are positive user inputs.
- Split lines must sum to the absolute value of the reconciled bank posting.
- The generated category postings use the opposite sign of the bank posting.
- Each split account must satisfy the same real-category eligibility rules as plain categorization.
- Split save marks the ledger transaction confirmed for user-initiated splits.
- Split save replaces only non-reconciled postings and preserves the reconciled bank posting.
- The mutator validates posting count, per-currency zero sum, account team ownership, and reconciled-posting invariants before commit.

## Imported transfer behavior

The postings model allows two imported bank transactions to reconcile one ledger transaction when both sides of a transfer are known.

Example:

```txt
Checking    -1,000 DKK   reconciles Checking bank transaction
Savings      1,000 DKK   reconciles Savings bank transaction
```

This refactor does not expose new transfer UI. It should avoid adding model assumptions that make direct imported-to-imported transfer matching impossible. The earlier clearing-account transfer design is deferred/superseded by this model direction for future work.

A later transfer-matching feature can merge or create a ledger transaction with two reconciled postings, after verifying amount, currency, opposite sign, team ownership, both linked bank ledger accounts, and date-window rules.

## Display and balance behavior

Balance derivation should use postings rather than movement debit/credit pairs.

For each account, compute the signed sum of postings involving that account. Then apply account display rules:

- debit-normal accounts display the signed sum directly
- credit-normal accounts display the negated signed sum for available-balance style views

Examples:

Bank-like account:

```txt
Checking postings total: 10,000 DKK
Displayed balance:      10,000 DKK
```

Envelope account:

```txt
Groceries signed total: -400 DKK
Displayed available:    400 DKK
```

Spending and income reports can still present user-friendly positive totals without changing posting signs.

Balances and reports must keep currencies separate. A single display balance may only be shown when the view has a well-defined currency or all included postings share one currency; otherwise the UI/model must expose per-currency totals or a deliberate empty/unsupported state.

## UI behavior

The refactor should keep the current UI shape as much as possible:

- Transactions page still shows imported transactions with category select, split action, AI action, confirmation status, amount, and bank account.
- Categories page still shows derived account/category balances.
- Individual bank-account pages still show imported transactions for that account.
- Users should not need to understand postings to use categorization or splits.

Model helpers should adapt postings into the existing row/view models so most components can stay focused on presentation.

Imported transaction rows are derived from reconciled postings, not from `ledger_transactions.bankTransactionId`. A row represents one imported bank transaction / one reconciled bank posting. For a row, derive:

- row identity from the reconciled bank transaction or posting
- ledger transaction id from the posting's parent transaction
- amount, currency, date, description, counterparty, and bank account from the reconciled bank transaction
- bank-account-page filtering from the reconciled bank transaction's bank account
- category label and selected category from non-reconciled postings on the same ledger transaction
- split lines from non-reconciled category postings only

An ordinary imported transaction has two postings and is not a split. It is a split only when the non-reconciled explanatory side has multiple category postings or multiple real category accounts. Reconciled bank postings must not appear in `splitLines`.

A future direct imported transfer with two reconciled postings may produce one row per imported bank transaction while sharing one parent ledger transaction. Until transfer UI exists, avoid row-model assumptions that require a parent ledger transaction to have only one reconciled posting.

## Zero and data access

Ledger postings are app/domain data and must be Zero-backed.

The refactor should update:

- Drizzle schema
- migrations or local schema reset path
- Zero generation config
- generated Zero schema
- Zero queries
- Zero mutators
- client-side model builders
- server-side ledger repository helpers

Do not hand-edit generated Zero schema except through the existing generation command.

Write ownership:

- User-initiated categorization, split, confirmation, and clear-categorization actions are app/domain writes and should run through Zero mutators.
- Bank import/provider sync is external-provider orchestration and may use server-only services with short database transactions.
- AI categorization is external LLM orchestration and may use server-only services with short database transactions before and after the external call.
- Server-side repository helpers should own shared posting validation so Zero mutators, bank import, and AI application paths enforce the same invariants.
- User-facing reads for Zero-backed app/domain tables should continue through Zero queries.

## Authorization

Existing team-based authorization rules still apply.

Server-side mutators and repository operations must verify:

- the user belongs to the ledger transaction's team for user-initiated writes
- selected accounts belong to the same team
- selected accounts satisfy real-category eligibility for categorization/splits
- reconciled bank transactions belong to bank accounts in the same team
- the posting account used to reconcile a bank transaction is the same-team ledger account linked to that bank transaction's bank account
- ledger accounts with `linkedBankAccountId` belong to the same team as the linked bank account
- cross-team postings cannot be created
- two-sided imported transfer matching cannot reconcile a bank transaction from another team

Zero client-side filters are not sufficient authorization. Mutators must enforce authorization server-side.

## AI categorization impact

AI categorization should continue to choose category accounts. The write path changes from replacing debit/credit movement rows to replacing non-reconciled postings.

AI metadata fields on `ledger_transactions` can remain transaction-level:

- confidence
- reasoning
- processing started at
- categorized by

AI candidate loading must resolve imported transaction details through reconciled postings rather than `ledgerTransactions.bankTransactionId`. Similar confirmed examples should read posting-based categories rather than movement debit/credit pairs, and they should exclude examples that do not have exactly one eligible real category unless the AI prompt is later updated to understand splits.

## Account detail and reports impact

Account detail history and dashboard balances must be recalculated from postings.

Important interpretations:

- bank account history uses postings on the selected bank-linked ledger account, especially postings reconciled to imported bank transactions
- linked-bank account history must derive from reconciled postings, not raw `bank_transactions`, so unreconciled or inconsistent imports cannot masquerade as ledger history
- spending category activity uses positive debit-style category postings from bank-import ledger transactions as user-facing spending
- envelope balances use account normal-balance display rules
- reports keep signed posting totals separate from display-normalized balances
- multi-currency totals are separated by currency

Existing charts and transaction lists should preserve their user-facing meanings while changing their input model.

## Local data reset

Because the app is in development and no production data is deployed, the implementation may use a destructive local schema/data reset instead of a careful backwards-compatible migration.

The implementation should still keep the schema and generated files coherent so a fresh database can be created from migrations or the chosen local reset path.

Implementation planning should choose and document the exact reset/migration sequence. The expected file areas are:

- `src/db/schema.ts`
- `drizzle/` migrations and meta snapshots, or a documented destructive reset path
- `drizzle-zero.config.ts`
- generated `src/zero/schema.ts` from `pnpm zero:generate` or `just zero-generate`
- `src/zero/queries.ts`
- Zero mutator definitions and server mutators
- repository helpers and model builders
- test database reset helpers such as `tests/helpers/db.ts`
- schema/codegen tests such as Zero schema tests

## Testing plan

Add focused tests for:

- building import ledger drafts with signed postings
- import idempotency: one bank transaction gets one reconciled posting
- import idempotency under a simulated uniqueness conflict/race
- re-import provider change handling for changed amount/currency after reconciliation
- categorization preserves the reconciled bank posting id/link and replaces only opposite postings
- positive imported amount categorization balances to zero
- negative imported amount categorization balances to zero
- split validation requires positive inputs summing to the bank posting absolute amount
- split writes one reconciled bank posting and multiple category postings
- ordinary imported transactions with exactly two postings render as not split
- split line models exclude reconciled bank postings
- row model derives bank transaction identity, amount, currency, date, bank account, category label, and bank-account filtering from reconciled postings
- balance derivation from postings for debit-normal and credit-normal accounts
- balance derivation keeps currencies separate and validates per-currency zero sum
- transaction row model derives category label and split state from postings
- account detail model derives chart/activity data from postings
- linked-bank account detail history derives from reconciled postings, not raw bank transactions
- server mutators reject cross-team accounts or inaccessible transactions
- server mutators reject inactive, system, Uncategorized-as-confirmed, bank-linked, and non-category account selections where appropriate
- server mutators reject postings that reconcile another team's bank transaction
- server mutators reject mismatched bank-account ledger account reconciliation
- future transfer-matching helper tests, if implemented in this refactor, reject cross-team two-sided matches
- categorization, split, confirmation, clear/reset categorization, AI categorization, and transfer matching do not update `bank_transactions` fields
- confirmed transaction validation uses posting-based real categories
- AI categorization candidate loading and similar example loading read posting-based categories and posting-linked bank transactions
- Zero schema exposes `ledgerPostings`
- Zero schema no longer exposes `ledgerTransactionMovements` or `ledgerTransactions.bankTransactionId`
- Zero queries authorize postings by parent ledger transaction/team membership
- test reset helpers clear the new postings table and no longer reference legacy movements

Run focused tests, full unit tests, typecheck, lint, and build after implementation. The implementation plan should list exact commands, expected to include at least:

```bash
pnpm db:generate
pnpm zero:generate
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

Use `just db-generate`, `just db-migrate`, or `just zero-generate` instead where the implementation plan chooses the `just` workflow.

## Acceptance criteria

The refactor is ready when:

- no application code depends on `ledger_transaction_movements`
- no application code depends on `ledger_transactions.bankTransactionId`
- `ledger_transactions.bank_transaction_id` is removed from Drizzle schema, Zero config/generated schema, relations, queries, repository code, AI loaders, model builders, and tests
- imported bank transactions reconcile exact ledger postings through `ledger_postings.bank_transaction_id`
- `ledger_postings.bank_transaction_id` has a database uniqueness constraint for non-null values
- import idempotency is backed by the posting-level uniqueness constraint and handles provider factual changes deliberately
- categorization and split UI behavior still works from the user's perspective
- ordinary imported transactions are not displayed as splits merely because they have one bank posting and one category posting
- dashboard/category/account balances derive from signed postings
- linked-bank account detail history derives from reconciled postings
- Zero schema and queries expose postings correctly and do not expose legacy movement or transaction-level bank-link fields
- tests cover the core invariants, authorization boundaries, immutable-import regressions, schema/codegen expectations, and user-facing flows
- `docs/ACCOUNTING_MODEL.md` remains consistent with the implemented model
- `docs/DATABASE.md` is updated so its Zero-synced app/domain table list includes the ledger tables and postings

## Open implementation choices

These implementation details remain to decide in the implementation plan:

- whether balance enforcement is repository-only for now or also backed by Postgres triggers
- exact migration/reset command sequence for local development
- exact user-facing handling for provider factual changes detected during re-import
