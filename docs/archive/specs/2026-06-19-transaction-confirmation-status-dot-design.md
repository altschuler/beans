# Transaction Confirmation Status Dot Design

## Status

Approved in conversation on 2026-06-19. Written before implementation planning.

## Summary

The transaction list dot should represent whether a transaction needs attention, not raw AI confidence. A green dot means the transaction does not need attention, but the UI should still distinguish AI high-confidence categorization from explicit user confirmation.

Add user confirmation fields to ledger transactions so users can confirm that an AI-categorized transaction is correct without losing the fact that AI originally categorized it. Add AI reasoning to the model response and persist it so the UI can explain why AI chose a category.

## Goals

- Let users confirm an AI-categorized transaction directly from the transaction list.
- Preserve both facts: AI set the category, and a user later confirmed it.
- Make the status dot an attention/review marker rather than a direct AI confidence marker.
- Show red for any effectively uncategorized transaction, not only AI failures.
- Store and show concise AI reasoning in the dot tooltip.

## Non-goals

- Full audit history of every category or confirmation change.
- Expanded transaction details UI.
- User-configurable confidence thresholds.
- Changing the existing AI confidence scale.

## User-facing behavior

The transaction list dot becomes a status/attention marker:

- Bright/full green: human-confirmed. This includes manual categorization and AI categorizations that the user confirmed by clicking the dot.
- Softer green: AI categorized with high confidence, but the user has not explicitly confirmed it.
- Yellow: AI applied a plausible category, but the transaction still needs review.
- Red: transaction is effectively uncategorized. This includes any transaction whose current category is Uncategorized, not just cases where AI could not categorize it.
- Gray: AI is currently processing.

Clicking a confirmable AI-result dot confirms the current categorization and changes the dot to bright green. The dot should have `title` and accessible label text. For AI-categorized rows, the tooltip includes the AI reasoning when present.

The dot should remain compact in the existing AI/status column. The clickable dot is preferred over adding another visible button to the already dense category column.

## Data model

Add nullable fields to `ledger_transactions`:

- `user_confirmed_at` timestamp
- `user_confirmed_by` text/user id
- `ai_reasoning` text

Keep existing `categorized_by` semantics as “who set the current category”:

- manual category/split: `categorized_by = 'user'`
- AI applied category: `categorized_by = 'ai'`
- no applied category: may remain `null` or existing value according to the current operation

This allows an AI-categorized transaction to later have both:

- `categorized_by = 'ai'`
- `user_confirmed_at` / `user_confirmed_by` set

## Write behavior

### Manual categorization and splits

Manual category and split writes should:

- set `status = 'confirmed'`
- set `categorized_by = 'user'`
- set `user_confirmed_at = now()`
- set `user_confirmed_by = current user id`
- clear stale AI confidence/reasoning for the current interpretation, unless implementation finds a strong reason to preserve it elsewhere

### AI categorization

AI categorization should require a concise reasoning string in the structured model response.

Server handling should:

- persist `ai_reasoning` with the AI result
- persist `ai_confidence`
- set `categorized_by = 'ai'` when AI applies a category
- clear prior `user_confirmed_at` / `user_confirmed_by` when AI changes or reapplies the interpretation
- keep confidence behavior from the current design:
  - confidence `0`: no category applied, remains `needs_review`
  - confidence `1`: category applied, remains `needs_review`
  - confidence `2`: category applied, `status = 'confirmed'`

High-confidence AI rows therefore show softer green because they are confirmed by automation but not by a user.

### User confirmation mutator

Add a narrow Zero mutator, for example `ledger.confirmTransaction`.

Input:

- `ledgerTransactionId`

Server-side behavior:

1. Authenticate through the Zero mutate request context.
2. Verify the current user is a member of the transaction’s team.
3. Verify the transaction is a bank-import ledger transaction with a real, non-bank, non-system categorization account.
4. Reject effectively Uncategorized transactions.
5. Set `status = 'confirmed'`.
6. Set `user_confirmed_at = now()` and `user_confirmed_by = current user id`.
7. Clear `ai_processing_started_at`.
8. Preserve `categorized_by`, including `categorized_by = 'ai'`.

Use Zero because this is ordinary user-facing domain data mutation.

## Dot derivation

Dashboard model should derive the dot from combined transaction state in priority order:

1. Recently processing → gray.
2. Effectively Uncategorized category → red.
3. User-confirmed (`user_confirmed_at` set, or manual user categorization according to implementation-compatible rules) → bright green.
4. AI high-confidence confirmed (`ai_confidence = 2`, no user confirmation) → softer green.
5. AI plausible/needs review (`ai_confidence = 1`) → yellow.
6. AI unable/very low confidence (`ai_confidence = 0`) → red.
7. Otherwise, if still needs review → red or an attention state consistent with Uncategorized detection.

The exact implementation can choose helper names, but the helper should be covered by focused tests so the dot is no longer directly tied to `aiConfidence`.

## AI response shape and prompt

Extend the structured AI response for each suggestion with:

```ts
reasoning: string
```

Prompt guidance should require concise, user-readable reasoning, such as:

- mention matching merchant/counterparty patterns when relevant
- mention similar confirmed examples when they influenced the decision
- avoid exposing internal chain-of-thought; provide a short explanation only
- keep reasoning safe for display in a tooltip

The server should validate that reasoning is present and persist a bounded string. If necessary, truncate to a safe maximum length before storing.

## Error handling

- Confirming an inaccessible transaction returns a safe not-found/unauthorized error.
- Confirming an uncategorized transaction fails with a safe validation error; the user must choose a category first.
- Confirming while AI is processing should either be disabled in UI or rejected server-side if it would race with active processing.
- Missing or invalid AI reasoning should fail schema validation rather than silently storing an incomplete AI result.

## Testing plan

Add or update tests for:

- Dashboard dot derivation:
  - manual/user-confirmed rows show bright green
  - AI high-confidence confirmed but not user-confirmed rows show soft green
  - AI medium-confidence rows show yellow
  - any effectively Uncategorized row shows red
  - processing rows show gray
  - AI reasoning appears in tooltip/accessibility text
- Confirm mutator:
  - authorizes by team membership
  - rejects inaccessible transactions
  - rejects effectively Uncategorized transactions
  - sets `status`, `userConfirmedAt`, and `userConfirmedBy`
  - preserves `categorizedBy = 'ai'`
- Manual categorization and split writes set user confirmation fields.
- AI categorization response schema requires reasoning.
- AI categorization persists `aiReasoning`.
- Drizzle and generated Zero schema expose the new fields.

## Migration/backfill

- Add the new nullable columns.
- Existing confirmed user/manual rows may be backfilled with `user_confirmed_at = updated_at` where the row is known to be user categorized.
- Existing AI-categorized rows should keep `user_confirmed_at = null` so they show as AI-confirmed/soft green until the user explicitly confirms them.

## Open implementation details

- Choose exact color tokens/classes for bright green and softer green in implementation, using existing design-system conventions.
- Choose whether manual categorization clears `ai_reasoning` immediately or preserves it until the next AI attempt. The preferred default is to clear it because it no longer describes the current user-set interpretation.
