# Transaction review and categorization

## What the Transactions page is for

The Transactions page shows imported bank transactions that need review or have already been interpreted. Rows are bank-transaction-first: the row id and all row actions use `bankTransactionId`.

A row may have no ledger interpretation yet. In that case it still appears as `Choose category` and needs review.

## Category selector

The category cell is the main interaction surface. Opening it shows a searchable popover with:

- category choices
- transfer choices
- an AI categorize action
- a Split action

Category choices are active, same-team, non-bank, non-system category accounts. Bank-linked accounts and locked system accounts are not normal categories.

## Manual categorization

Choosing a category creates or replaces the internal ledger interpretation for the bank transaction:

1. load and authorize the bank transaction through team membership
2. load the bank-linked ledger account for the source bank account
3. delete any existing interpretation for this bank transaction
4. create a balanced ledger transaction with one reconciled bank posting and one category posting
5. mark the interpretation confirmed by the user
6. clear stale AI metadata for that bank transaction

The imported bank transaction row itself is not edited.

## Splits

Split mode opens inside the same selector popover. It maintains at least two lines and has a “fill remaining amount” convenience action.

Saving a split replaces the interpretation with one reconciled bank posting and multiple category postings. The server still validates that split line amounts are positive and sum to the absolute bank transaction amount.

## Transfers

Transfer choices are derived from the team's other active bank-linked ledger accounts.

The selector labels the direction from the current bank transaction amount:

- negative source amount: `Transfer to: <account>`
- positive source amount: `Transfer from: <account>`

The server validates the target bank account and searches for an unreconciled opposite bank transaction on that account. Current implementation requires a same-currency, opposite-amount candidate within the transfer matching date window. When found, Penge writes one ledger transaction with two reconciled bank postings.

## Status dot and confirmation

The status dot is an attention marker, not a raw AI confidence display.

- gray/spinner: AI processing is fresh
- red: uncategorized or AI could not categorize
- yellow: AI suggested a plausible category and review is recommended
- softer green: AI categorized with high confidence, but the user has not explicitly confirmed it
- bright green: user-confirmed

Clicking a confirmable AI-result dot confirms the current interpretation by `bankTransactionId`. Confirmation preserves that AI originally categorized the transaction while recording user confirmation metadata on the ledger transaction.

## Clear categorizations

The Transactions page has a destructive `Clear categorizations` action behind a confirmation dialog.

Current behavior deletes bank-import ledger interpretations for accessible teams and leaves imported bank transactions intact. The result is that imported rows return to a needs-category state; users or AI can categorize them again.

This action is mainly a product reset/review tool. It must not delete or mutate bank transaction evidence.
