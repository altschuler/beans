# Envelope Ledger Product Design

## Status

Draft approved in conversation on 2026-06-17. This document describes the product model and terminology before technical implementation planning.

## Summary

The app should use a team-scoped envelope budgeting ledger. Imported bank transactions remain immutable source records. The app creates matching internal transactions that explain those bank transactions using internal accounts such as bank accounts, Ready to budget, Take-away, Fuel, Salary, Savings goals, Uncategorized, and Opening balances.

This keeps a clean split between external bank evidence and the team's internal accounting/budgeting interpretation.

## Core concepts

### Bank transaction

A bank transaction is imported from a bank provider and represents external evidence:

- It is immutable after import except for provider sync metadata updates that do not change the factual transaction.
- It belongs to an imported bank account.
- It records what the bank says happened: amount, currency, date, description, counterparty, and raw provider payload.
- It must have exactly one linked internal transaction.

Example: "On 2026-06-17, Checking changed by -100 DKK at Wolt."

### Internal account

An internal account is a team-scoped account/bucket that can hold a derived balance.

Internal accounts include:

- real bank accounts linked from imported bank accounts
- Ready to budget
- Uncategorized
- Opening balances
- income accounts
- spending accounts
- savings or goal accounts
- correction/adjustment accounts

Accounts belong to one flat account group. Groups are organizational labels, not a tree.

### Internal transaction

An internal transaction is the app's accounting/budgeting interpretation of an event.

It has event-level metadata such as:

- date
- description
- source, such as bank import, manual, opening balance, or budgeting
- status, such as confirmed or needs_review
- optional linked bank transaction
- optional AI confidence for generated interpretations

Every internal transaction has one or more movements.

### Internal transaction movement

A movement is a balanced debit/credit pair:

- debit account
- credit account
- amount
- currency

Most internal transactions have exactly one movement. Split transactions have multiple movements under the same internal transaction.

The UI can present movements with friendly language such as "move money", "fund account", or "categorize spending", but the internal model should keep explicit debit and credit accounts. This avoids ambiguity for spending, where both the bank balance and the available budget balance decrease.

Examples:

- spending: debit Take-away, credit Checking: 100 DKK
- budget allocation: debit Ready to budget, credit Take-away: 500 DKK
- opening balance: debit Checking, credit Opening balances: 12,345 DKK

## Product invariants

The initial product model should enforce these invariants:

1. Bank transactions are immutable source records.
2. Every bank transaction must have exactly one linked internal transaction.
3. A bank-linked internal transaction must include movement(s) whose total bank-account-side amount and currency exactly match the bank transaction.
4. Internal transactions always have one or more movements.
5. All internal accounts and account groups are team-scoped.
6. Account groups are flat, not nested.
7. Account balances are derived from internal transaction movements, not stored as editable manual balances.
8. Account types define how debits and credits affect the displayed balance.
9. Budget/spending accounts may go negative; negative balances should be visible as overspending that needs funding.

## Reconciliation / afstemning

Reconciliation is the connection between immutable bank evidence and internal interpretation.

A bank transaction is reconciled when:

- it has exactly one linked internal transaction
- the linked internal transaction uses the corresponding internal bank account
- the total debit or credit movement involving that bank account matches the bank transaction amount and currency exactly

Sign convention for bank-linked transactions:

- positive bank transaction amount: debit the internal bank account by that amount
- negative bank transaction amount: credit the internal bank account by the absolute value of that amount

Categorization confidence is separate from reconciliation. A transaction can be reconciled and still need user review if the selected account is uncertain.

## Import workflow

When bank transactions are imported, the app should immediately ensure each one has a matching internal transaction.

For each imported bank transaction:

1. Find or create the internal bank account linked to the imported bank account.
2. Create exactly one linked internal transaction if one does not already exist.
3. Add movement(s) whose bank-account-side debit/credit total matches the imported amount and currency.
4. Choose the opposite internal account:
   - high AI confidence: use the predicted account
   - medium/low AI confidence: still use the predicted account, but mark for review
   - very low AI confidence: use Uncategorized and mark for review
5. Set transaction status:
   - `confirmed` when accepted by a user or high-confidence automation
   - `needs_review` when the interpretation should be checked

The import flow should prevent unreconciled bank transactions. If an invariant is ever broken, the UI should surface it as a reconciliation problem.

## Splits

One bank transaction links to one internal transaction. That internal transaction can contain multiple movements.

Example: one supermarket bank transaction for `-100 DKK` on Checking, split between groceries and household.

Bank transaction:

| id | bank account | amount | currency | description |
| --- | --- | ---: | --- | --- |
| `bt_1` | Checking | `-100.00` | DKK | Supermarket |

Internal transaction:

| id | linked bank transaction | description | status |
| --- | --- | --- | --- |
| `it_1` | `bt_1` | Supermarket | confirmed |

Movements:

| debit account | credit account | amount | currency |
| --- | --- | ---: | --- |
| Groceries | Checking | `70.00` | DKK |
| Household | Checking | `30.00` | DKK |

The Checking-side credit total is `100 DKK`, matching the `-100 DKK` bank transaction. The split is therefore reconciled as one explanation of one bank transaction.

## Opening balances

Opening balances are needed because bank providers may only provide a limited transaction history, such as the last three months.

The opening balance should represent the bank account balance immediately before the first imported transaction for that account, so that:

`opening balance + imported bank transactions = current actual bank balance`

Opening balances should be represented as normal internal transactions, not hidden account fields.

Example:

Debit Checking, credit Opening balances: 12,345 DKK

The transaction should be dated before the first imported transaction. It is not linked to a bank transaction.

The opening balance workflow should make the starting cash available for budgeting. One clean way to do that is to create a follow-up internal movement from Opening balances into Ready to budget after setup, or to fold that into the setup flow while still keeping an auditable opening-balance source. After imported transactions are categorized, remaining positive money should sit in Ready to budget until the user allocates it to spending or savings accounts.

## Accounts and groups

### Required/default accounts

Every team should have at least:

- Ready to budget: money available to allocate
- Uncategorized: fallback account when the app or AI cannot confidently choose a useful account
- Opening balances: source account for bank opening balances
- one internal bank account per linked real bank account

### Account fields

An internal account should support:

- team ownership
- group membership
- name
- optional description / AI guidance text
- type, such as bank, ready_to_budget, income, expense, savings, or adjustment
- active/archived state

The description should help both users and AI. Example: "Use for prepared food, delivery, cafes, restaurants, and takeaway orders."

### Default chart of accounts

The default setup is an editable starting point, not a fixed taxonomy.

Suggested initial groups/accounts:

#### Income

- Salary
- Reimbursements
- Interest
- Other income

#### Everyday spending

- Groceries
- Take-away / restaurants
- Household
- Clothing

#### Transport

- Fuel
- Public transportation
- Parking
- Vehicle maintenance

#### Housing

- Rent / mortgage
- Utilities
- Insurance
- Maintenance

#### Health

- Medicine
- Dentist
- Doctor / treatment

#### Savings goals

- Emergency fund
- Vacation
- Large purchases

#### Adjustments

- Uncategorized
- Opening balances
- Corrections

The exact default chart can be refined during implementation or product iteration.

## AI categorization and review

AI confidence is stored on the internal transaction as an overall confidence in the generated interpretation. The AI is expected to usually suggest one movement, not splits.

Suggested behavior:

1. High confidence
   - use predicted account
   - mark internal transaction `confirmed`
2. Medium/low confidence
   - use predicted account
   - mark internal transaction `needs_review`
   - store confidence and optional metadata/rationale later
3. Very low confidence
   - use Uncategorized
   - mark internal transaction `needs_review`

Uncategorized is therefore only the fallback when the AI does not have a useful guess. A transaction can need review while still being assigned to a likely account.

## Balances and reporting

Balances are derived from movements.

The account type determines how debits and credits affect the displayed balance:

- Bank accounts are debit-normal: debits increase the displayed balance, credits decrease it.
- Budget, income, savings, and adjustment accounts are credit-normal: credits increase the displayed available balance, debits decrease it.
- Negative budget/spending balances are allowed and should be flagged as overspending.

This means a card purchase can debit Take-away and credit Checking, decreasing both the Take-away available balance and the Checking bank balance.

Useful reports/views:

- current account balance: how much is available now
- spending over a period: debit movements on spending accounts grouped by account or group
- income over a period: credit movements into income/ready accounts, usually paired with bank-account debits
- Uncategorized: transactions involving the Uncategorized account
- review queue: internal transactions with `needs_review`
- reconciliation problems: bank transactions missing a matching internal transaction or with mismatched totals

## Product language

The product should use approachable language without hiding the accounting model too much.

User-facing actions can include:

- set opening balance
- categorize transaction
- confirm transaction
- move money
- fund account
- split transaction
- review AI suggestion

Where useful, the UI should show the underlying debit/credit movement, such as "debit Ready to budget, credit Take-away" or "debit Take-away, credit Checking". Friendly labels can sit alongside the accounting details.

## Editing behavior

Users can edit the internal interpretation of a bank transaction:

- change the account
- split one movement into multiple movements
- mark as confirmed
- move to or from Uncategorized
- edit notes/description on the internal transaction

Users cannot edit the immutable imported bank transaction itself.

Manual internal transactions not linked to bank transactions are also allowed:

- budgeting: debit Ready to budget, credit Take-away
- moving budget: debit Take-away, credit Groceries
- correction: debit or credit Corrections against the affected account, depending on the correction
- opening balance: debit Bank account, credit Opening balances

## Open implementation questions

These are intentionally deferred to the implementation plan:

- exact database table and column names
- exact account type enum values
- exact AI confidence thresholds
- how much account editing is exposed in the first UI iteration
- whether to add audit history immediately or later
- how to handle multi-currency beyond requiring bank-linked transactions to match the bank transaction currency
