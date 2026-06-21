# Accounting Model

This document describes Penge's accounting model. It focuses on product and domain concepts, not implementation details.

## Goals

Penge should keep a clean separation between:

- **External evidence**: imported bank transactions that describe what a bank says happened.
- **Internal interpretation**: ledger transactions and postings that describe how the user wants to account for that event.

The UI should hide most of this distinction. A user should usually see a bank transaction with a category, split, or transfer destination. Behind the scenes, that visible row is reconciled by ledger postings.

## Core concepts

### Bank transaction

A bank transaction is imported from an external provider and represents immutable evidence for one account.

It records facts such as:

- bank account
- amount and currency
- booking/value date
- description and counterparty
- provider metadata

Imported bank transactions should not be edited by the user. If the user categorizes, splits, or transfers a bank transaction, Penge edits the internal ledger interpretation, not the imported evidence.

### Ledger account

A ledger account is an internal account used for accounting, budgeting, reporting, and reconciliation.

Ledger accounts include:

- bank-like accounts, such as current/checking, savings, cash, investment, or negative-balance loan-style accounts
- envelope/category accounts, such as Groceries or Take-away
- income accounts
- adjustment accounts, such as Uncategorized or Corrections

Some ledger accounts correspond to imported bank accounts. Manual bank-like accounts can also exist without an external provider.

### Ledger transaction

A ledger transaction is one accounting event.

Examples:

- an imported card purchase after categorization
- an imported salary payment
- a transfer between two accounts
- a manual interest, correction, or valuation adjustment
- a budget/envelope allocation

A ledger transaction contains postings. A ledger transaction is balanced when the postings sum to zero for each currency.

### Ledger posting

A ledger posting is one signed amount on one ledger account within a ledger transaction.

Rules:

- Every ledger transaction has at least two postings.
- Posting amounts are signed.
- For each ledger transaction, postings must sum to zero per currency.
- A posting may reconcile exactly one imported bank transaction.

The sign is accounting direction, not whether the event is good or bad. Display rules decide how balances and reports are shown to users.

## Reconciliation with bank transactions

An imported bank transaction reconciles exactly one ledger posting.

That posting must:

- be on the ledger account corresponding to the bank transaction's bank account
- have the same amount and currency as the bank transaction
- belong to the ledger transaction that explains the event

Splits do not create multiple bank-linked postings. A split has one bank-linked posting and multiple category postings.

## Examples

### Imported transaction before categorization

A card purchase of `-100 DKK` from Checking is imported. Before the user categorizes it, Penge stores only the imported bank transaction as external evidence. No ledger transaction or postings are created yet.

The Transactions page still shows the bank transaction as needing a category. Once the user chooses a category, split, or transfer destination, Penge creates the internal ledger interpretation.

### Categorized card purchase

The user categorizes the same purchase as Groceries:

```txt
Checking    -100 DKK   reconciles imported bank transaction
Groceries    100 DKK
```

The bank posting proves the Checking account movement. The Groceries posting explains the category.

### Split card purchase

A single imported purchase of `-100 DKK` is split between Dentist and Take-away:

```txt
Checking    -100 DKK   reconciles imported bank transaction
Dentist       30 DKK
Take-away     70 DKK
```

The imported bank transaction still reconciles one posting only: the Checking posting.

### Incoming salary

An imported salary payment of `20,000 DKK` into Checking:

```txt
Checking       20,000 DKK   reconciles imported bank transaction
Salary        -20,000 DKK
```

The positive Checking posting increases the bank-like account balance. The Salary posting records the income source.

### Transfer between two imported accounts

If both sides are imported, two bank transactions can be reconciled by postings in one ledger transaction.

Checking transaction: `-1,000 DKK`  
Savings transaction: `1,000 DKK`

```txt
Checking    -1,000 DKK   reconciles Checking bank transaction
Savings      1,000 DKK   reconciles Savings bank transaction
```

This avoids a clearing account when both imported bank transactions are known and matched.

### Transfer to a manual account

A transfer from imported Checking to a manual investment account:

```txt
Checking       -2,000 DKK   reconciles imported bank transaction
Investment      2,000 DKK
```

The manual account has no imported bank transaction. Its balance changes because the ledger transaction includes a posting for it.

### Manual account adjustment

A manual investment valuation adjustment of `500 DKK`:

```txt
Investment     500 DKK
Corrections   -500 DKK
```

This changes the manual account balance while keeping the ledger transaction balanced.

### Envelope funding and spending

Envelope/category balances use display rules. Funding an envelope might be represented as:

```txt
Ready to budget   500 DKK
Groceries        -500 DKK
```

A later grocery purchase:

```txt
Checking    -100 DKK   reconciles imported bank transaction
Groceries    100 DKK
```

The signed Groceries total moved from `-500` to `-400`. Because Groceries is a credit-normal envelope account, this displays as `400 DKK` available.

## Display rules

Posting signs are canonical ledger values. User-facing balances are derived from account behavior.

### Bank-like accounts

Bank-like accounts display the signed sum of their postings directly.

Examples:

- Checking balance `10,000 DKK` means the account has positive value.
- A negative-balance loan-style account can display `-50,000 DKK` naturally without a special liability mode.

### Envelope/category accounts

Envelope/category accounts use normal-balance display rules.

For example, a spending category can be funded by a negative signed posting and reduced by positive spending postings. The UI displays this as available money going down when spending happens.

### Reports

Reports can present activity in user-friendly terms without changing the ledger model.

Examples:

- spending reports show category spending as positive amounts spent
- income reports show income as positive amounts received
- bank-account history shows signed account movement over time

## Invariants

The model relies on these invariants:

1. Imported bank transactions are immutable external evidence.
2. A ledger transaction has at least two postings.
3. Postings in a ledger transaction sum to zero per currency.
4. An imported bank transaction may be unreconciled until the user or automation creates an internal ledger interpretation.
5. An imported bank transaction reconciles at most one ledger posting.
6. A reconciled posting matches the bank transaction's amount, currency, and corresponding ledger account.
7. A split transaction has one bank-linked posting and multiple opposite postings.
8. Transfers between two imported accounts can reconcile two bank transactions in one ledger transaction.
9. Manual accounts are reconciled by ledger postings, not external bank transactions.
10. Balances are derived from postings, not stored as editable account fields.
11. Display rules may differ by account kind, but they do not change the underlying postings.

## User-facing principle

Users should not need to think about bank transactions, ledger transactions, and postings for normal use.

Common actions should be phrased as:

- categorize transaction
- split transaction
- transfer to account
- add manual transaction
- adjust account balance
- fund category

Penge should translate those actions into balanced ledger transactions and reconciled postings behind the scenes.
