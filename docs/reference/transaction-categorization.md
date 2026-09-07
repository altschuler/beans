# Transaction review and categorization

## What the Transactions page is for

The Transactions page shows bank transactions that need review or have already been interpreted. Rows are bank-transaction-first: the row id and all row actions use `bankTransactionId`.

Rows can come from provider sync or manual entry. A row may briefly appear locally before the import-time interpretation syncs down, but durable server state creates a balanced Uncategorized interpretation. It still appears as `Choose category` and needs review until the user categorizes it.

## Category selector

The category cell is the main interaction surface. Opening it shows a searchable popover with:

- category choices
- transfer choices
- a Split action

Category choices are active, same-team, non-bank, non-system category accounts. Bank-linked accounts and locked system accounts are not normal categories.

## Manual categorization

Choosing a category creates or replaces the internal ledger interpretation for the bank transaction:

1. load and authorize the bank transaction through team membership
2. load the bank-linked ledger account for the source bank account
3. load the existing import-time Uncategorized interpretation
4. keep the reconciled bank posting row in place
5. replace the Uncategorized posting with one category posting or multiple split postings
6. mark the interpretation confirmed by the user
7. clear stale AI metadata for that bank transaction

The imported bank transaction row itself is not edited.

## Splits

Split mode opens inside the same selector popover. It maintains at least two lines and has a “fill remaining amount” convenience action.

Split form lines are temporary decimal strings for user editing. Saving a split parses those strings into canonical scale-4 integer money amounts, then replaces the interpretation with one reconciled bank posting and multiple category postings. The server still validates that split line amounts are positive and sum to the absolute bank transaction amount.

## Transfers

Transfer choices are derived from the team's other active bank-linked ledger accounts.

The selector labels the direction from the current bank transaction amount:

- negative source amount: `Transfer to: <account>`
- positive source amount: `Transfer from: <account>`

The server validates the target bank account and searches for an unreconciled opposite bank transaction on that account. Current implementation requires a same-currency, opposite-amount candidate within the transfer matching date window. When found, Penge writes one ledger transaction with two reconciled bank postings.

## Status dot and confirmation

The status dot is an attention marker, not a raw AI confidence display. It reflects the row's latest persisted categorization state. Historical AI results remain reviewable, but no automated categorization runs in the app.

- red: uncategorized or AI could not categorize
- yellow: AI suggested a plausible category and review is recommended
- softer green: AI categorized with high confidence, but the user has not explicitly confirmed it
- bright green: user-confirmed

Clicking a confirmable AI-result dot confirms the current interpretation by `bankTransactionId`. Confirmation preserves that AI originally categorized the transaction while recording user confirmation metadata on the ledger transaction.

## Clear categorizations

The Transactions page has a destructive `Clear categorizations` action behind a confirmation dialog.

Current behavior resets bank-import ledger interpretations for accessible teams to balanced Uncategorized interpretations and leaves imported bank transactions intact. The result is that imported rows return to a needs-category state; users can categorize them again.

This action is mainly a product reset/review tool. It must not delete or mutate bank transaction evidence.
