# Accounting and ledger model

## Core objects

### Bank transaction

A bank transaction is imported from a bank provider and represents external evidence. Users do not edit bank transactions directly.

A bank transaction can be unreconciled or reconciled:

- **Unreconciled** means no `ledger_postings.bank_transaction_id` points to it yet. The Transactions page still shows the row and asks the user to choose a category.
- **Reconciled** means exactly one ledger posting points to that bank transaction.

### Ledger transaction

A ledger transaction is one internal accounting event. It is the wrapper around postings and carries event-level metadata such as source, status, date, description, `categorizedBy`, and user confirmation fields.

For imported bank transactions, ledger transactions are interpretations. They can be deleted and recreated when the user changes a category, split, or transfer.

### Ledger posting

A ledger posting is one signed amount on one ledger account. Postings are the canonical accounting layer.

Money amounts are stored and synced as scale-4 signed integers with a separate currency code; examples in this doc use decimal display values for readability. See [Money representation and display](./money.md) for the canonical data format and UI display rules.

Important invariants:

- A ledger transaction has at least two postings.
- Postings sum to zero per currency.
- A posting may reconcile at most one bank transaction.
- A bank transaction may be reconciled by at most one posting.
- A reconciled posting must match the bank transaction's amount, currency, and linked bank ledger account.

Example categorized purchase:

```txt
Checking    -100 DKK   reconciles bank transaction
Groceries    100 DKK
```

The bank posting mirrors the imported bank transaction. The category posting explains it.

## Accounts

Ledger accounts include:

- bank-linked accounts, one per linked bank account
- user categories such as Groceries, Salary, Vacation, or Dentist
- locked system accounts such as Ready to budget, Uncategorized, and Opening balances

Balances are derived from postings, not stored as editable account fields. Balance aggregation uses integer arithmetic and does not collapse mixed-currency totals into one misleading amount.

Display rules depend on account behavior:

- bank-like accounts display the signed posting sum directly
- category/envelope-style accounts display credit-normal available balances
- multi-currency totals should not be collapsed into one misleading number

## Splits

A split preserves one bank-linked posting and creates multiple category postings.

```txt
Checking    -100 DKK   reconciles bank transaction
Groceries     70 DKK
Household     30 DKK
```

The imported bank transaction is still reconciled once. The split is just a richer interpretation of the opposite side.

## Transfers

Transfers are not ordinary categories. A matched imported transfer is represented as one ledger transaction with two bank-linked postings:

```txt
Checking    -1,000 DKK   reconciles checking bank transaction
Savings      1,000 DKK   reconciles savings bank transaction
```

The active model uses direct bank-to-bank postings for matched transfers. Earlier clearing-account transfer specs are historical and superseded.

## Account detail history

Account detail charts deliberately use different semantics by account kind:

- **Spending categories** show actual bank-import spending categorized to that account. Budget moves are ignored.
- **Linked bank accounts** show cumulative imported bank movement based on reconciled postings.
- **Savings/envelope categories** show money added and removed through ledger activity, including non-bank moves.

This avoids a misleading generic “account development” chart. A category balance and a category spending history are related but not the same thing.
