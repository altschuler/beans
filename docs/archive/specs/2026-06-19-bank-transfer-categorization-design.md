# Bank Transfer Categorization Design

## Status

Superseded/deferred by `docs/specs/2026-06-20-canonical-ledger-postings-refactor-design.md`. This document records the earlier clearing-account transfer design, but it should not be implemented as the active transfer direction unless it is explicitly revived.

## Summary

Support categorizing transfers between linked bank accounts with a dedicated transfer action in the categorization UI, such as `Transfer to: Savings`. Transfers are modeled as two ordinary imported bank ledger transactions that are updated atomically through a hidden system clearing account named `Internal transfers`.

The first version does not add a separate transfer-match table. The invariant is behavioral: a transfer categorization succeeds only when the server can auto-match the selected transaction to the counterpart transaction on the target bank account. If no counterpart exists, the operation fails and leaves both transactions unchanged.

## Accounting model

The existing ledger imports one ledger transaction per bank transaction, and each ledger transaction must remain balanced on its own. A direct bank-to-bank movement on both imported rows would double-count the transfer, so transfers use an internal clearing account.

For a transfer of 100 from Checking to Savings:

Checking bank transaction `-100`:

```txt
Dr Internal transfers 100
Cr Checking 100
```

Savings bank transaction `+100`:

```txt
Dr Savings 100
Cr Internal transfers 100
```

Together, `Internal transfers` nets to zero and the net effect is the correct bank-to-bank movement:

```txt
Dr Savings 100
Cr Checking 100
```

## System account

Add a team-scoped system ledger account:

```txt
systemKey: internal_transfers
name: Internal transfers
type: adjustment
normalBalance: credit
status: active
linkedBankAccountId: null
```

The account should be added to `SYSTEM_LEDGER_ACCOUNT_KEYS` and to the team default chart/backfill path so each team has exactly one internal-transfer account. It should be hidden from normal categorization options. Users should not be able to choose a plain `Internal transfers` category for a single transaction, because that would allow one-sided transfers. It is only used by the transfer categorization workflow.

## User-facing behavior

The category select should include transfer options derived from the team’s linked bank accounts:

```txt
Transfer to: Savings
Transfer to: Checking
```

For the selected transaction, omit transfer options that point to the same bank account as the transaction itself.

When the user selects `Transfer to: <bank account>`, the client calls a dedicated transfer categorization mutator rather than the normal single-category mutator.

## Auto-match rules

The server finds the matching counterpart transaction on the selected target bank account. A candidate must satisfy all required predicates:

- same team
- bank-import ledger transaction
- target bank account matches the selected transfer destination
- same currency
- opposite sign
- same absolute amount
- selected and candidate bank transactions both have a booking date
- booking date within a fixed ±7 calendar-day window from the selected transaction booking date
- candidate transaction is not already `confirmed`
- candidate transaction does not already have a movement involving the `Internal transfers` account

If candidates exist, choose deterministically:

1. closest absolute booking-date distance
2. stable fallback by ledger transaction id

If no candidate exists, the mutator fails and leaves both ledger transactions unchanged.

## Transfer write behavior

Add a narrow Zero mutator, for example:

```ts
ledger.categorizeTransfer({
  ledgerTransactionId,
  targetBankAccountId,
})
```

Server-side behavior:

1. Authenticate with the Zero mutate request context.
2. Verify the current user is a member of the selected ledger transaction’s team.
3. Verify the selected ledger transaction is a bank-import transaction.
4. Verify the target bank account belongs to the same team and is not the source bank account.
5. Load or create the team’s `Internal transfers` system account.
6. Find the counterpart using the auto-match rules.
7. In the same DB transaction, replace movements for both ledger transactions:
   - negative source amount: debit `Internal transfers`, credit source bank ledger account
   - positive source amount: debit source bank ledger account, credit `Internal transfers`
   - counterpart gets the opposite clearing movement based on its own sign
8. Mark both ledger transactions `confirmed`.
9. Clear AI processing/confidence fields consistently with manual user categorization.
10. Record user confirmation metadata on both transactions.

All steps must be atomic. There is no pending or one-sided transfer state.

## Error handling

User-facing errors should be safe and concise:

- no matching transaction: “No matching transfer was found in the target account.”
- inaccessible source transaction or target account: generic not-found/unauthorized style error
- same-account transfer target: invalid transfer target
- missing linked bank ledger account: reconciliation problem
- missing internal transfer account creation failure: reconciliation problem

The UI should keep the previous visible state intact when the mutator fails.

## Data model choice

Do not add a transfer-match table for v1. The clearing account and atomic two-sided mutator satisfy the immediate requirement while keeping the schema small.

A future explicit transfer-match table may be useful if the product needs:

- showing “matched with transaction X” in the UI
- undoing/changing a transfer pair as one object
- stronger prevention of rematching previously transferred rows
- richer audit/debugging of transfer matching decisions

## Testing plan

Add focused tests for:

- transfer options exclude the current transaction’s own bank account
- selecting a transfer option calls the transfer mutator, not normal categorization
- server authorization for source ledger transaction and target bank account
- same-team and different-bank-account validation
- exact amount/currency/opposite-sign matching
- fixed ±7 day date window
- closest-date candidate selection
- stable id tie-breaker when date distance ties
- no-match failure leaves both transactions and movements unchanged
- successful transfer rewrites both ledger transactions through `Internal transfers`
- successful transfer marks both transactions confirmed and records user confirmation metadata
- normal category lists do not expose `Internal transfers`

## Out of scope

- manual selection among transfer candidates
- configurable date windows
- cross-currency transfers
- pending one-sided transfers
- explicit transfer-match table
- transfer undo/change UI
- AI transfer detection
