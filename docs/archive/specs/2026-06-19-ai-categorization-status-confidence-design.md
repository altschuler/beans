# AI Categorization Status and Confidence Design

## Status

Approved in conversation on 2026-06-19. This updates the earlier AI ledger categorization design now that basic AI categorization exists.

## Summary

Add a visible AI processing state and completed confidence marker for ledger transactions, and change model confidence from a decimal score to a small integer scale.

The transaction list should also move from stacked cards to a table-first layout on desktop. The AI state is shown in a dedicated, compact AI column as a dot-only marker with tooltip and screen-reader text. Category actions move into the category column as icon-only buttons using the existing `lucide-react` dependency.

## User-facing behavior

### Processing indication

When AI categorization starts, the server marks the selected ledger transactions with `aiProcessingStartedAt`. Clients read that field through Zero and show:

- a global indicator near the batch action, such as “AI running · 3 processing”
- a gray dot in the AI column for each transaction currently being processed

The processing indicator is persisted as transaction state, not browser-local state. If a process crashes or a request never clears the flag, the UI should treat old `aiProcessingStartedAt` values as stale rather than indefinitely processing.

### Completed confidence indication

When AI finishes, the transaction row shows only a colored dot in the AI column. The dot has a tooltip/title and accessible label, but no visible text label.

- Red dot: confidence `0`, very low; AI could not categorize reliably and left the transaction unchanged or Uncategorized.
- Yellow dot: confidence `1`, plausible; AI applied a category but the transaction still needs user review.
- Green dot: confidence `2`, confident; AI applied a category and confirmed the transaction.

Rows with no AI result have no AI dot unless currently processing.

### Transaction table layout

On desktop/tablet, the Recent transactions section becomes a table with columns:

1. Description
2. Date
3. Bank account
4. Category
5. AI
6. Amount

The Category column contains:

- the category selector
- an icon-only AI categorize/retry button
- an icon-only Split button

The separate Actions column is removed. Use `lucide-react` icons rather than emoji. Candidate icons: `Sparkles` for AI and a split/branch-style icon for split. Icon buttons must have `title` and `aria-label` text.

On small screens, the layout may stack row fields to preserve usability.

## Confidence model

Change the LLM output confidence from a decimal `0..1` score to an integer enum:

- `0`: very low confidence; cannot categorize. Do not apply the suggested category. Leave the existing category as-is, which is usually Uncategorized, and keep `status = 'needs_review'`.
- `1`: medium confidence; needs review. Apply the suggested category and keep `status = 'needs_review'`.
- `2`: high confidence. Apply the suggested category and set `status = 'confirmed'`.

The structured output should allow no category for confidence `0`, for example `categoryAccountId: null`. If the model returns confidence `0` with a category, the server ignores the category.

## Server architecture

AI categorization should be orchestrated by a TanStack server function, not a Zero mutator.

The server function should:

1. authenticate with `ensureSession()`
2. authorize/select the requested transaction or capped batch by team membership
3. set `ledger_transactions.ai_processing_started_at = now()` in a short committed database update
4. call the LLM outside any Zero mutator or long-lived database transaction
5. validate returned transaction ids, category ids, and confidence values
6. apply results in short committed database updates
7. clear `ai_processing_started_at` in a `finally` path for all selected transactions

Manual categorization and split writes can remain Zero mutators because they are ordinary app/domain writes. AI categorization is external orchestration and should use a server function boundary.

## Database and Zero schema

Update `ledger_transactions`:

- change `ai_confidence` from decimal to an integer-compatible field storing `0`, `1`, `2`, or `null`
- add nullable `ai_processing_started_at` timestamp

Regenerate the Zero schema after the Drizzle schema and migration change so the client can read both fields.

## Error handling

- If the LLM call fails, keep transaction categories/statuses unchanged and clear `aiProcessingStartedAt`.
- If a partial result contains invalid transaction ids or category ids, ignore those suggestions and clear processing for the affected request.
- Confidence `0` is not an error. It is a completed AI attempt with a red marker and no applied category.
- Missing `OPENAI_API_KEY` should return a safe server error and clear processing flags.
- Stale processing timestamps should not block future AI attempts.

## Documentation update

Create or update `docs/SERVER.md` to document the boundary:

- Zero mutators run inside mutation processing and database transaction semantics.
- Do not perform long-running external calls such as LLM/provider calls inside Zero mutators.
- Use server functions/services for external orchestration, with short committed database updates before and after the external work.
- Use an outbox/background worker if work needs durable retry beyond a request lifecycle.

## Testing plan

Add or update tests for:

- LLM prompt/schema expects confidence `0 | 1 | 2`, not decimal scores.
- Confidence `0` leaves category unchanged, keeps `needs_review`, persists `aiConfidence = 0`, and clears processing.
- Confidence `1` applies category, keeps `needs_review`, persists `aiConfidence = 1`, and clears processing.
- Confidence `2` applies category, marks `confirmed`, persists `aiConfidence = 2`, and clears processing.
- AI server function sets processing before model work and clears it on success and failure.
- AI server function authorizes by team membership and rejects inaccessible transactions.
- Dashboard/table model exposes bank account, AI confidence, and processing state.
- Dashboard renders table columns, dot-only AI markers with tooltip/accessibility text, and Lucide icon buttons in the Category column.
- Zero mutators no longer orchestrate AI categorization.

## Out of scope

- Durable job queue or full AI jobs table.
- Cross-device progress history beyond the current transaction fields.
- Learning from past categorization corrections.
- User-configurable confidence thresholds.
