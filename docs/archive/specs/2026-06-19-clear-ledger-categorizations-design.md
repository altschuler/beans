# Clear Ledger Categorizations Design

## Status

Approved in conversation on 2026-06-19. Do not commit unless explicitly requested.

## Summary

Add a destructive dashboard action that clears all imported bank-linked ledger categorizations for the authenticated user's accessible teams, while leaving immutable imported bank account transactions untouched.

The reset should make imported transactions look as if they were just imported: every bank-import ledger transaction returns to `Uncategorized` and `needs_review` with a single movement that reconciles to the linked bank transaction.

## User-facing behavior

The ledger dashboard shows a `Clear categorizations` action near existing categorization/sync actions.

Because the action is destructive, clicking the button opens a shadcn-style confirmation dialog. The dialog explains that imported bank account transactions are kept, but ledger categorizations, split movements, user confirmations, and AI metadata are cleared. The reset only runs after the user confirms.

On success the dashboard shows a short message such as `Cleared ledger categorizations. Imported bank transactions were kept.` On failure it shows a safe error toast/message and leaves the visible state intact.

## Data behavior

For each accessible `ledger_transactions` row where `source = 'bank_import'` and `bank_transaction_id` is present:

1. Authorize through `team_members` for the current user.
2. Load the linked `bank_transactions` row and linked internal bank `ledger_accounts` row.
3. Load the same-team system `Uncategorized` ledger account.
4. Delete existing `ledger_transaction_movements` for those ledger transactions.
5. Insert one replacement movement per ledger transaction using the existing bank-linked movement builder:
   - positive bank amount: debit linked bank ledger account, credit `Uncategorized`
   - negative bank amount: debit `Uncategorized`, credit linked bank ledger account
6. Update each ledger transaction to:
   - `status = 'needs_review'`
   - `ai_confidence = null`
   - `ai_reasoning = null`
   - `ai_processing_started_at = null`
   - `categorized_by = null`
   - `user_confirmed_at = null`
   - `user_confirmed_by = null`

Do not delete or update `bank_transactions`.

## Architecture

Use a narrow Zero mutator because this is a user-facing write to Zero-backed app/domain data. Add the reset logic to `src/ledger/categorization.server.ts` beside the existing categorize/confirm commands so it can reuse movement-building helpers and authorization patterns.

If the shadcn dialog component does not exist, add a local `src/components/ui/dialog.tsx` wrapper backed by `@radix-ui/react-dialog`, matching existing UI component style.

## Testing plan

Add focused tests for:

- server reset replaces categorized/split movements with `Uncategorized` movements and resets metadata
- server reset affects all authorized bank-import ledger transactions and does not touch unauthorized teams
- server reset leaves `bank_transactions` rows intact
- Zero mutator delegates to the server reset command with authenticated user id
- dashboard renders the clear action behind a confirmation dialog and only calls the reset mutator after confirmation
