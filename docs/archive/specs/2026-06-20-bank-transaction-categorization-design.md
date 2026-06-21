# Bank-transaction-centric categorization and transfers

## Context

The Transactions page is for categorizing imported bank transactions. Ledger transactions and postings are the internal interpretation of those bank transactions and should not define which rows appear on the page.

Currently the import path precreates a balanced `bank_import` ledger transaction for every imported bank transaction using Uncategorized. That makes rows visible, but it blurs the model: external bank evidence should exist independently from the internal accounting interpretation. This design changes the flow so ledger transactions are created when the user categorizes, splits, or marks a transfer.

The database can be wiped for this change, so no data migration/backfill is required.

## Goals

- Show one Transactions page row per imported bank transaction.
- Stop creating ledger transactions during bank import.
- Create ledger interpretations lazily when a user categorizes, splits, or transfers a bank transaction.
- Replace the native category `<select>` with an inline searchable popover.
- Include transfer choices in the selector: `Transfer to: <account name>` for negative source amounts, `Transfer from: <account name>` for positive source amounts.
- If possible, automatically reconcile the matching counter bank transaction when selecting a transfer.

## Non-goals

- No manual transfer-matching UI in this pass.
- No migration of existing precreated Uncategorized ledger transactions.
- No support for partial transfer matching.
- No new reporting or account-detail behavior beyond what is needed to keep existing views working.

## Transaction lifecycle

Bank import should only upsert immutable `bankTransactions` and ensure the linked ledger account exists for each imported bank account. It should not insert `ledgerTransactions` or `ledgerPostings`.

A bank transaction is uncategorized when no ledger posting reconciles it via `ledgerPostings.bankTransactionId`.

When a user chooses an interpretation:

1. Category selection creates one ledger transaction with:
   - a posting on the source bank ledger account reconciled to the bank transaction
   - one opposite posting on the selected category account
2. Split selection creates one ledger transaction with:
   - a posting on the source bank ledger account reconciled to the bank transaction
   - multiple opposite category postings
3. Transfer selection creates one ledger transaction with:
   - a posting on the source bank ledger account reconciled to the selected bank transaction
   - a counter posting on the selected target bank ledger account
   - if an exact unreconciled counter bank transaction is found, the counter posting reconciles that counter bank transaction too

## Transfer matching

When selecting a transfer target, the server searches for unreconciled bank transactions on the selected target bank account with:

- same currency
- opposite amount
- no existing reconciled posting

If one or more exact candidates exist, the server chooses one deterministic candidate and creates a transfer ledger transaction with two reconciled bank postings. Candidate selection is stable: order by `bookingDate` ascending with nulls last, then `valueDate` ascending with nulls last, then bank transaction id ascending. There is no ambiguity prompt in this pass.

If no exact candidate exists, the server creates a transfer ledger transaction with the source bank posting reconciled and the target bank-account posting unreconciled.

The Transactions page will then show:

- source row: `Transfer to: Target Account` for negative source amounts, or `Transfer from: Target Account` for positive source amounts
- matched counter row: the inverse label, derived from the same ledger transaction
- unmatched counter posting: no separate bank transaction row unless/until a bank transaction is later reconciled by a future matching feature

## Server API

Mutators should operate on `bankTransactionId` for normal transaction-row actions, because uncategorized imported rows do not have a ledger transaction yet.

Recommended mutation shape for single-choice categorization:

```ts
type CategorizeBankTransactionInput = {
  bankTransactionId: string
  selection:
    | {kind: 'category'; accountId: string}
    | {kind: 'transfer'; accountId: string}
}
```

Split can remain separate but should also use `bankTransactionId`:

```ts
type SplitBankTransactionInput = {
  bankTransactionId: string
  lines: Array<{accountId: string; amount: string}>
}
```

Server validation:

- The bank transaction must belong to a team accessible by the user.
- The source bank account must have a linked ledger account.
- Category accounts must be active real categorization accounts owned by the team.
- Transfer accounts must be active bank-linked ledger accounts owned by the team.
- The transfer target should not be the source bank account.
- Reconciled postings must match their bank transaction amount, currency, and linked bank account.
- Replacing an existing interpretation should preserve ledger balance and avoid leaving orphan postings.

## Replacing existing interpretations

A user can recategorize a bank transaction. If the source bank transaction already has a reconciled posting, the server should rebuild the interpretation for that bank transaction.

For a single-bank-transaction category or split, this means replacing the whole ledger transaction with a new balanced interpretation for the source bank transaction.

For an existing two-sided transfer, changing either side should detach the old transfer interpretation and create the new requested interpretation. Any previously matched counter bank transaction becomes unreconciled again unless it is also matched by the new interpretation.

## Dashboard model

The dashboard model should be bank-transaction-centric:

- Input includes bank transactions, bank accounts, ledger accounts, ledger transactions, and postings.
- Output transaction rows are built from bank transactions first.
- Each imported bank transaction appears once, subject to filters.
- The row id should be the bank transaction id.
- The row should carry `bankTransactionId`; `ledgerTransactionId` should be nullable because uncategorized imported rows have none.

Unreconciled rows:

- `canCategorize: true`
- category display: `Choose category`
- status indicator: Uncategorized / needs category
- split lines: empty

Reconciled rows:

- derive the ledger transaction from the posting that reconciles the bank transaction
- category rows show category name or split summary
- transfer rows show direction and counter bank-account name based on the current bank posting sign
- transfer rows remain selectable/editable through the same selector

## Selector UI

Replace the native `<select>` with an inline searchable popover in each transaction row.

Button display:

- `Choose category` for unreconciled rows
- selected category name for single-category rows
- `Split transaction` for split rows
- transfer label for transfer rows

Popover contents:

1. Search input: filters both categories and transfer options.
2. Transfers section:
   - one entry per other active bank-linked ledger account
   - label uses the current row amount sign:
     - negative source amount: `Transfer to: <account name>`
     - positive source amount: `Transfer from: <account name>`
   - excludes the current bank account
3. Categories section:
   - active real categorization accounts

The existing AI and split buttons remain next to the selector.

## Data flow

1. Import sync upserts bank transactions and ensures linked ledger accounts.
2. Zero queries load bank transactions plus existing ledger interpretations.
3. Dashboard model emits bank-transaction rows with optional interpretation metadata.
4. User opens selector and chooses category or transfer.
5. UI calls a bank-transaction-based mutator.
6. Server creates or replaces the ledger transaction/postings.
7. Zero sync updates rows; matched transfer counterpart automatically changes from Uncategorized to the inverse transfer label.

## Error handling

UI should show existing toast-style errors for failed mutations.

Important server errors should be explicit:

- `Bank transaction not found`
- `Bank transaction is already being categorized` when the bank transaction has an existing fresh AI-processing ledger interpretation
- `Invalid categorization account`
- `Invalid transfer account`
- `Cannot transfer to the same bank account`
- existing reconciled-posting invariant messages should remain exact where already tested

## Tests

Focused regression tests should cover:

- Import no longer inserts ledger transactions or postings.
- Dashboard model emits one row per bank transaction, including unreconciled bank transactions.
- Dashboard model derives category/split/transfer display from existing interpretations.
- Selector renders searchable category and transfer options with sign-correct labels.
- Selecting a category creates a lazy ledger transaction and postings.
- Selecting a transfer with no exact counter transaction creates a reconciled source posting plus unreconciled target bank-ledger posting.
- Selecting a transfer with one exact counter transaction creates one ledger transaction with two reconciled bank postings.
- Selecting a transfer with multiple exact counter transactions deterministically chooses one and leaves the others unreconciled.
- Recategorizing an existing transfer detaches the old counter bank transaction and creates the new interpretation.

## Acceptance criteria

- The Transactions page shows imported bank transactions even when no ledger transaction exists.
- Bank import does not precreate Uncategorized ledger interpretations.
- Users can search categories from the row selector.
- Users can select transfer entries for each other bank account.
- Transfer labels are directionally correct for both sides of a matched transfer.
- Relevant unit tests, typecheck, full tests, lint, and diff whitespace checks pass.
