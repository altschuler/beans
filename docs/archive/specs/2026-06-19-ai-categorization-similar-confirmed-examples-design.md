# AI Categorization Similar Confirmed Examples Design

## Status

Approved direction in conversation on 2026-06-19. Written for review before implementation planning.

## Summary

Improve AI ledger categorization by looking up similar already-categorized bank-import ledger transactions and including them as examples in the LLM categorization input. Similar examples should strongly influence the model, especially when they were categorized by a user.

Add a `categorized_by` field to ledger transactions to distinguish categories applied by a user from categories applied by AI. Similar-example lookup prioritizes user-confirmed transactions, while allowing high-confidence AI-confirmed transactions as fallback context.

## Goals

- Give the LLM concrete historical examples for near-identical transactions.
- Prefer examples that were reviewed or categorized by the user.
- Keep lookup server-side and same-team scoped.
- Keep the first implementation simple enough to test and iterate.
- Structure the helper so fuzzy search can improve later without changing the LLM input contract.

## Non-goals

- Embeddings or vector search.
- Merchant-rule automation outside the LLM prompt.
- Automatic category creation.
- Split-category suggestions from AI.
- User-facing history controls for example selection.

## Data model

Add nullable `ledger_transactions.categorized_by` with allowed values:

- `user`
- `ai`
- `null`

Write behavior:

- Manual category changes set `categorizedBy = 'user'`.
- Manual split changes set `categorizedBy = 'user'`.
- AI-applied categorization sets `categorizedBy = 'ai'`.
- If a user edits an AI category, it becomes `user`.

Backfill recommendation:

- Rows with `ai_confidence is not null` become `categorized_by = 'ai'`.
- Rows with `status = 'confirmed'` and no AI confidence become `categorized_by = 'user'` so existing reviewed history is immediately useful.
- Rows still needing review remain `null` unless currently categorized by AI in a low-confidence state; implementation should choose the behavior consistent with the current AI status model.

## Similar example lookup

Add a server-only helper near the AI categorization module, for example `loadSimilarCategorizationExamples(tx, input)`.

Inputs:

- current user id
- transaction/team ids selected for AI categorization
- already-loaded transaction details, if available
- per-transaction limit, default 5

Candidate scope:

- same team only
- bank-import ledger transactions
- confirmed transactions by default
- not the transaction currently being categorized
- has a resolved non-bank categorization account
- eligible category account still exists in the same team

Ranking should prefer:

1. `categorizedBy = 'user'`
2. exact normalized counterparty match
3. strong normalized description match
4. same currency and same sign
5. similar amount
6. recent examples
7. `categorizedBy = 'ai'` only after good user examples

The first version can use SQL and TypeScript scoring without embeddings. If available and acceptable for the database, `pg_trgm` can improve fuzzy description/counterparty matching; otherwise normalize strings in TypeScript and rank a bounded candidate set.

## LLM input shape

Extend each transaction sent to the model with examples:

```ts
type AiCategorizationSimilarExample = {
  ledgerTransactionId: string
  date: string | null
  description: string
  counterpartyName: string | null
  amount: string
  currency: string
  categoryAccountId: string
  categoryName: string
  categoryGroupName: string
  categorizedBy: 'user' | 'ai' | null
  similarityReason: string
}
```

Then include:

```ts
similarConfirmedExamples: AiCategorizationSimilarExample[]
```

on each transaction in `AiCategorizationModelInput.transactions`.

Keep the list small, around 3 to 5 examples per transaction, to avoid prompt bloat.

## Prompt guidance

Update the AI categorization system prompt to say:

- User-confirmed similar examples are strong evidence.
- Near-identical merchant/counterparty examples should usually use the same category.
- Do not blindly copy an example if amount direction, currency, merchant context, or description indicates a different category.
- If similar user-confirmed examples disagree, lower confidence.
- AI-confirmed examples are useful but weaker than user-confirmed examples.
- The model must still choose only from supplied eligible category ids.

## Architecture and data flow

1. AI categorization server command authorizes and loads eligible target transactions.
2. It loads eligible category accounts for each involved team.
3. It loads similar confirmed examples for each target transaction, same-team scoped.
4. It builds the model input with categories, target transactions, and per-transaction examples.
5. The LLM returns category suggestions.
6. Server validation remains authoritative: returned transaction ids and category ids must match loaded inputs.
7. Applying AI suggestions sets `categorizedBy = 'ai'`.
8. Manual categorization/split paths set `categorizedBy = 'user'`.

## Error handling

- Similar-example lookup failure should fail the AI categorization request rather than silently producing lower-quality prompts, unless the failure is explicitly classified as non-critical.
- No similar examples is valid; send an empty example array.
- Unknown or archived categories in historical rows should be excluded from examples.
- Team scoping must be enforced in SQL, not only after loading.

## Testing plan

Add tests for:

- Manual categorization sets `categorizedBy = 'user'`.
- AI categorization sets `categorizedBy = 'ai'`.
- Backfill/migration maps existing confirmed AI-confidence rows to `ai` and confirmed non-AI rows to `user`.
- Similar example lookup excludes other teams, needs-review rows, uncategorized/system/bank accounts, and the current transaction.
- Similar example ranking places user-confirmed exact matches before AI-confirmed or weaker matches.
- Model input includes `similarConfirmedExamples` on each transaction.
- Prompt/schema still rejects unknown transaction/category ids.
- Batch categorization keeps examples grouped by team.

## Open implementation choice

Choose one fuzzy strategy for v1:

1. SQL + TypeScript scoring over a bounded candidate set.
2. Postgres `pg_trgm` extension and similarity ranking.

Recommendation: start with SQL + TypeScript scoring unless we want to introduce `pg_trgm` now. Keep the helper interface stable so `pg_trgm`, merchant keys, or embeddings can replace the internal search later.
