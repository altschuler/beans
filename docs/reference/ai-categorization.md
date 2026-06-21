# AI categorization

## Purpose

AI categorization suggests categories for imported bank transactions. It is a review accelerator, not the authority of record. Server-side validation decides whether a model suggestion is allowed to affect ledger data.

## Server boundary

AI categorization runs through TanStack server functions and server-only services, not Zero mutators. This keeps LLM calls outside Zero mutation processing while still letting clients read resulting domain state through Zero.

Current entry points:

- single-row AI categorize by `bankTransactionId`
- batch AI categorize for up to 25 eligible needs-review transactions

The refresh-safe start-and-return background-task design is not implemented. The current server functions await the AI workflow before returning.

## Processing state

`bank_transactions.ai_processing_started_at` is the persisted row-level processing marker. The UI treats recent values as active processing and stale values as retryable.

This state supports:

- disabling row AI actions while a row is processing
- showing a global processing count
- showing the row status dot as processing
- preventing manual recategorization races while AI is fresh

## Model input

The server builds a prompt from:

- eligible category accounts for the same team
- imported bank transaction details
- bank account name
- counterparty and description
- similar confirmed examples from the same team

Eligible AI categories are active real categories: income, expense, or savings accounts with no linked bank account and no system key.

## Similar confirmed examples

Before calling the model, the server looks for already-confirmed, same-team transactions with one eligible category. User-confirmed examples rank above AI-confirmed examples.

Examples are intentionally small and prompt-shaped. They are not a rules engine, embeddings system, or merchant automation layer. They provide context so the model can reuse known patterns while still choosing only from current eligible category ids.

## Confidence scale

AI confidence is an integer enum:

- `0`: could not categorize reliably. No category is applied; the transaction still needs review.
- `1`: plausible. The category is applied but the transaction still needs review.
- `2`: confident. The category is applied and the interpretation is marked confirmed by AI.

The model must also return concise display-safe reasoning. Reasoning is stored on the bank transaction and can appear in the status tooltip.

## Applying suggestions

For confidence `1` or `2`, AI uses the same bank-transaction-first interpretation path as manual categorization, with `categorizedBy = 'ai'`.

For confidence `0`, AI records the confidence and reasoning on the bank transaction but does not create or replace the ledger interpretation.

AI application is guarded so stale model results should not overwrite work that became confirmed after the model input was loaded.

## User confirmation after AI

High-confidence AI rows can be confirmed by the user from the status dot. This preserves both facts:

- AI set the category (`categorizedBy = 'ai'`)
- a user later confirmed the interpretation (`userConfirmedAt` / `userConfirmedBy`)

That distinction is why the UI uses separate soft-green and bright-green states.
