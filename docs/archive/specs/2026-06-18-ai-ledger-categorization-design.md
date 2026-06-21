# AI Ledger Transaction Categorization Design

## Status

Draft approved in conversation on 2026-06-18. Written for review before implementation planning.

Update: `docs/specs/2026-06-19-ai-categorization-status-confidence-design.md` supersedes the v1 Zero-mutator orchestration and decimal confidence details. AI categorization should now be orchestrated by TanStack server functions, with `0 | 1 | 2` confidence and persisted processing state on ledger transactions.

## Summary

Add AI-assisted categorization for imported ledger transactions. The first version uses a simple LLM workflow: send eligible ledger categories and one or more bank-import ledger transactions to an OpenAI model through Vercel AI SDK, receive structured category suggestions with confidence scores, and apply those suggestions to ledger transactions.

The feature starts with explicit user actions rather than automatic bank-sync categorization:

- a dashboard-level button to AI-categorize up to 25 recent `needs_review` imported transactions
- a per-transaction button to AI-categorize one transaction

## Model and library

Use Vercel AI SDK packages:

- `ai`
- `@ai-sdk/openai`

Use an OpenAI small model for v1. OpenAI's current model docs list smaller variants such as `gpt-5.4-mini` and `gpt-5.4-nano`; v1 should use `gpt-5.4-nano` for cost and latency, with the model name isolated in server code so it can be changed later.

Runtime configuration:

- require `OPENAI_API_KEY` server-side
- add an `OPENAI_API_KEY` placeholder to `.env.example`
- do not expose the key to client code

## User-facing behavior

### Batch categorization

The ledger dashboard shows an AI batch action near the review count, such as “AI categorize up to 25”.

When clicked, the server selects up to 25 recent imported ledger transactions with `status = 'needs_review'` that are accessible to the current user. The operation can be run again to process the next batch.

### Single transaction categorization

Each imported transaction row has an “AI categorize” action. It runs the same categorization workflow for only that ledger transaction.

### Applying suggestions

The LLM returns a category and confidence for each transaction.

- If confidence is `>= 0.90`, apply the category and mark the ledger transaction `confirmed`.
- If confidence is `< 0.90`, apply the category but keep the ledger transaction `needs_review`.
- Store the confidence in `ledger_transactions.ai_confidence`.

The user can still manually change the category after an AI suggestion using the existing inline categorization UI.

## Eligible categories

The AI may only choose active, non-bank, non-system categories from the same team.

Exclude at least:

- bank-linked ledger accounts
- `Uncategorized`
- `Opening balances`
- `Corrections`
- any archived account
- any account from another team

This keeps the model from selecting fallback or accounting-cleanup categories as normal spending/income categories.

## Prompt and confidence guidance

The prompt should include:

- the eligible category list with id, name, type, group name, and description where available
- transaction id, date, amount, currency, bank account name, description, and counterparty where available
- instructions to choose exactly one supplied category id per transaction
- instructions to avoid inventing categories
- confidence calibration guidance

Confidence guidance:

- `0.95–1.00`: exact or near-certain merchant/category match, or a clear recurring pattern
- `0.85–0.94`: strong semantic match with only minor ambiguity
- `0.70–0.84`: plausible but ambiguous between multiple categories
- `<0.70`: weak guess; likely needs human review

The first version does not add advanced heuristics, historical examples, merchant rules, or embeddings. Those can be added later inside the same server module.

## Architecture and data flow

Add a server-only AI categorization module, likely `src/ledger/ai-categorization.server.ts`, responsible for:

1. authorizing the current user through team membership
2. loading eligible categories
3. loading transaction details for either a single transaction or a capped batch
4. calling the OpenAI model through AI SDK with structured output validation
5. validating returned transaction ids and category ids against the loaded inputs
6. applying valid suggestions with existing ledger movement-building logic
7. setting `aiConfidence`
8. setting status to `confirmed` only when confidence is at least `0.90`

Expose the workflow through Zero server mutators:

- `ledger.aiCategorizeTransaction({ ledgerTransactionId })`
- `ledger.aiCategorizeNeedsReviewBatch({ limit?: number })`

The client mutator definitions in `src/zero/mutators.ts` should validate input and provide no-op optimistic stubs. The server implementation in `src/zero/mutators.server.ts` should call the server-only AI categorization command.

This preserves the project rule that Zero-backed app/domain writes go through Zero mutators. The LLM call and all authorization stay server-side.

## Persistence details

The implementation should reuse the existing categorization logic for accounting movements so bank transaction sign and bank-account side remain server-derived.

Manual categorization currently marks transactions confirmed. AI categorization needs a variant or option that can apply the selected account while choosing the final status based on confidence:

- high confidence: `confirmed`
- low confidence: `needs_review`

The implementation should update `ledger_transactions.ai_confidence` with the model confidence for applied suggestions.

## Error handling

- Missing `OPENAI_API_KEY`: fail safely with a clear server error and dashboard message.
- OpenAI/API failure: leave all transactions unchanged if no structured result is available.
- Invalid structured output: ignore invalid suggestions.
- Unknown transaction id or category id in model output: ignore that suggestion.
- Partial batch failure: apply valid suggestions and report partial success/failure counts.
- Authorization failures: return generic not-found/unauthorized style errors without leaking other teams' data.

The UI should keep the previous visible state intact and show concise status messages such as:

- “AI categorized 18 transactions; 7 still need review.”
- “AI could not categorize this transaction.”
- “AI categorization failed. Try again.”

## Testing plan

Add focused tests for:

- AI prompt/input building excludes bank, system, adjustment-cleanup, archived, and other-team accounts
- structured output validation rejects unknown category ids and transaction ids
- confidence `>= 0.90` marks `confirmed`
- confidence `< 0.90` keeps `needs_review`
- `aiConfidence` is persisted for applied suggestions
- single transaction AI mutator calls the server command
- batch AI mutator caps processing at 25 server-side
- dashboard renders the batch AI button and per-row AI button
- OpenAI/API failure leaves transactions unchanged

## Out of scope

- automatic categorization during bank sync
- learning from historical manual categorization
- merchant-specific rules
- embeddings or semantic search
- user-configurable confidence threshold
- category creation/editing
- split suggestions from AI
