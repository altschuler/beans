# Ledger Dashboard and Transaction Categorization Design

## Status

Draft approved in conversation on 2026-06-18. This spec covers the first user-facing ledger UI and transaction categorization workflow after the ledger foundation commit.

## Summary

The ledger foundation already creates internal ledger transactions for imported bank transactions during bank sync. Each imported bank transaction gets one linked ledger transaction, initially categorized against `Uncategorized` and marked `needs_review`. The next step is to make that ledger visible in the app and let users categorize transactions.

The app home should become a ledger dashboard. Bank linking and sync should move out of the dashboard to a dedicated banks page. Categorization should be inline for the common single-category case, with splits available as an opt-in secondary action that does not clutter the main transaction list.

## Architecture rule update

Update `docs/ARCHITECTURE.md` to make the app data write path explicit:

- App/domain data that is Zero-backed must use Zero for both reads and writes.
- Server functions are reserved for special cases, such as auth/session helpers, external provider orchestration, and tables intentionally not backed by Zero.
- Categorization writes therefore use narrow Zero mutators rather than TanStack server functions.

This aligns with the existing database guidance that user-facing app/domain data must be exposed through Zero.

## Navigation and page split

### Ledger dashboard

Route: `/app`

The current app home can be replaced entirely. `/app` becomes the main ledger dashboard, focused on:

- grouped ledger account balances
- review status, especially transactions that need categorization
- recent imported ledger transactions
- inline single-category editing
- an opt-in split editor per transaction

### Bank linking page

Route: `/app/banks`

Move the existing GoCardless bank-linking functionality to a dedicated page. This page keeps the current responsibilities:

- Danish institution search and selection
- start bank link flow
- linked bank account list
- manual sync button and sync status/error display

### Shell navigation

The protected app shell should expose simple navigation:

- Dashboard
- Banks

The shell title should stop describing the app as boilerplate.

## Ledger dashboard reads

The dashboard reads existing Zero-backed tables:

- `ledgerAccountGroups`
- `ledgerAccounts`
- `ledgerTransactions`
- `ledgerTransactionMovements`
- `bankTransactions`
- `bankAccounts`

The first version can derive balances client-side from synced movements.

Balance rules:

- debit-normal accounts: debits increase displayed balance, credits decrease it
- credit-normal accounts: credits increase displayed balance, debits decrease it
- display balances grouped by ledger account group
- highlight `Uncategorized` and `needs_review` as cleanup signals

## Transaction list behavior

The dashboard transaction list focuses on recent bank-import ledger transactions.

Each row should show:

- imported bank transaction description
- date
- bank account name
- bank amount/currency
- ledger status, especially `needs_review`
- current category or split summary
- inline category select for non-split transactions
- secondary split action

The category select should use existing active, non-bank ledger accounts. Category/account creation or editing is explicitly out of scope for this iteration.

For the common single-category case, changing the category should update the generated ledger interpretation and confirm the transaction. The main UI should not expose debit/credit details by default, but implementation must preserve the accounting model.

## Split behavior

Splits are included in the first categorization version but hidden behind an opt-in action such as `Split` on an individual transaction row.

The split editor should be compact and scoped to one transaction. It should let the user enter multiple category lines with amounts. Saving the split replaces the ledger transaction's movements with multiple movements that still reconcile to the original bank transaction.

Validation rules:

- split lines must use active, non-bank ledger accounts from the same team
- split amounts must be positive
- all split lines must use the bank transaction currency
- split totals must equal the absolute bank transaction amount
- the bank-account side must remain consistent with the original bank transaction sign
- saving a valid split marks the ledger transaction `confirmed`

Splits should not pollute the normal transaction list UI because they are expected to be rare.

## Zero mutators

Use narrow domain mutators rather than generic table writes.

### Categorize transaction mutator

Input:

- ledger transaction id
- selected ledger account id

Server-side behavior:

1. Authenticate through the existing Zero mutate request context.
2. Verify the current user is a member of the ledger transaction's team.
3. Verify the selected account belongs to the same team.
4. Verify the selected account is active and not a bank account.
5. Load the linked immutable bank transaction and linked bank ledger account.
6. Replace the transaction's movements with a single movement:
   - positive bank amount: debit bank account, credit selected account
   - negative bank amount: debit selected account, credit bank account
7. Mark the ledger transaction `confirmed`.

### Split transaction mutator

Input:

- ledger transaction id
- split lines of account id and amount

Server-side behavior:

1. Authenticate through the existing Zero mutate request context.
2. Verify the current user is a member of the ledger transaction's team.
3. Verify every selected split account belongs to the same team.
4. Verify every selected split account is active and not a bank account.
5. Load the linked immutable bank transaction and linked bank ledger account.
6. Validate that split amounts are positive and sum to the absolute bank transaction amount.
7. Replace existing movements with one movement per split line:
   - positive bank amount: debit bank account, credit split account
   - negative bank amount: debit split account, credit bank account
8. Mark the ledger transaction `confirmed`.

Future bank syncs must not overwrite already-linked ledger transactions. The current import helper already preserves existing ledger transactions by returning the existing id without modifying movements.

## Error handling

User-facing errors should be safe and specific where possible:

- inaccessible transaction: generic not found/unauthorized message
- account from another team: invalid category
- bank-linked transaction missing required bank-side account: reconciliation problem
- split total mismatch: explain that split amounts must match the bank amount
- inactive or bank account selected as category: invalid category

The UI should leave the previous visible state intact when a mutator fails and show a concise error message.

## Out of scope

This iteration does not include:

- creating, editing, archiving, or reordering ledger accounts/categories
- AI categorization
- opening balance setup workflow
- full reconciliation problem dashboard
- manual non-bank ledger transactions
- budget allocation workflows
- audit history UI

## Testing plan

Add focused tests for:

- architecture documentation update presence or review coverage as appropriate
- categorization mutator authorization
- categorization mutator same-team account validation
- categorization movement direction for positive and negative bank transactions
- split mutator total validation
- split mutator same-team and non-bank account validation
- split movement direction for positive and negative bank transactions
- dashboard balance derivation helper
- dashboard transaction categorization summary helper
- route/page split for dashboard and banks page, adapting existing banking dashboard tests

Run existing unit tests and typecheck after implementation.
