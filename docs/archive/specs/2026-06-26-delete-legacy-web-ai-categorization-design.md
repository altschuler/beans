# Delete legacy web-side AI categorization stack

## 1. Summary

Current AI categorization entry points in `apps/web` no longer perform model work in the TanStack Start server runtime. They authenticate the user, resolve/authorize team scope, reserve an app-visible workflow run, and delegate to the Flue sidecar's `categorize-transactions` workflow.

The old synchronous web OpenAI stack is now obsolete and should be removed rather than preserved behind abstractions. The implementation should delete the legacy web model caller and its web-built similar-example helper, remove the web-only AI SDK dependencies and `OPENAI_API_KEY` example, delete legacy tests that only cover the removed path, and keep the Flue/domain coverage that now owns AI behavior.

Recommended scope: one cleanup PR that removes the dead web stack and dependency/env references, followed by a separate follow-up PR for the larger row-level processing-state simplification (`bank_transactions.ai_processing_started_at`) if desired.

## 2. Current architecture

### Active web entry points

- `apps/web/src/ledger/ai-categorization-fns.ts` exposes TanStack server functions:
  - `aiCategorizeTransaction({bankTransactionId})`
  - `aiCategorizeNeedsReviewBatch({limit?})`
- `apps/web/src/ledger/ai-categorization-fns.server.ts` contains the server-side handlers. It no longer imports the legacy web OpenAI module. It delegates to:
  - `startFlueCategorizeTransactionWorkflow({userId, bankTransactionId})`
  - `startFlueCategorizeNeedsReviewWorkflow({userId})`

The batch `limit` input remains accepted by the public server function, but `runAiCategorizeNeedsReviewBatchForUser` intentionally ignores it because Flue owns workflow caps.

### Web-to-Flue starter

`apps/web/src/ledger/flue-categorization-workflow.server.ts` is the active web orchestration boundary:

- row run: resolves the bank transaction's accessible team through `bank_transactions -> bank_accounts -> team_members`
- batch run: resolves the user's current team from `team_members`
- reserves one active `agent_workflow_runs` row per team/workflow through `reserveActiveAgentWorkflowRun`
- calls `POST ${PENGE_FLUE_BASE_URL}/workflows/categorize-transactions` with `PENGE_FLUE_INTERNAL_TOKEN`
- passes trusted `appRunId`, `userId`, `teamId`, and optional `targetBankTransactionIds`
- marks the app run failed if Flue rejects admission

### Flue workflow and tools

`apps/flue/src/workflows/categorize-transactions.ts` owns long-running AI categorization. It supplies the agent with scoped read/write tools from:

- `apps/flue/src/agent-tools/read-tools.ts`
- `apps/flue/src/agent-tools/write-tools.ts`
- shared domain services in `packages/domain/src/read-projections.ts`
- shared guarded write logic in `packages/domain/src/categorization-service.ts`

Flue behavior now covers the important AI categorization semantics:

- trusted `userId`/`teamId`/target scope; model never supplies authorization scope
- broad scoped search over bank transactions, ledger transactions, and accounts
- eligible category discovery through `searchLedgerAccounts({eligibleCategoryOnly: true})`
- category, split, transfer, and unable results through one guarded `applyCategorizationSuggestion` tool
- confidence `0 | 1 | 2` storage and review semantics
- stale-write protection through `bank_transactions.categorization_revision`
- protection of confirmed or user-confirmed interpretations from agent overwrite
- workflow visibility through `agent_workflow_runs`, not the old synchronous web request

## 3. Evidence that the web AI stack is obsolete

### Source reachability

Searches for the legacy symbols show no production caller outside the two legacy files:

```bash
rg "aiCategorizeBankTransactions|categorizeWithOpenAI|loadSimilarCategorizationExamples|AiCategorization" apps packages docs
```

Production matches are limited to:

- `apps/web/src/ledger/ai-categorization.server.ts`
- `apps/web/src/ledger/similar-categorization-examples.server.ts`

Other non-archive matches are tests for those modules. Active web entry points import `./ai-categorization-fns.server`, and that file imports only `./flue-categorization-workflow.server`.

### Dependency/env reachability

Searches for direct web OpenAI usage show it is isolated to the legacy stack:

```bash
rg "@ai-sdk/openai|from 'ai'|OPENAI_API_KEY" apps packages docs package.json apps/*/package.json
```

Current non-archive matches:

- `apps/web/package.json` depends on `@ai-sdk/openai` and `ai`
- `apps/web/.env.example` includes `OPENAI_API_KEY`
- `apps/web/src/ledger/ai-categorization.server.ts` imports `@ai-sdk/openai` and `ai` and reads `OPENAI_API_KEY`
- `apps/web/tests/unit/ledger-ai-categorization-server.test.ts` mocks the removed SDKs and env
- `apps/flue/.env.example` includes `OPENAI_API_KEY` for the Flue sidecar and must stay

The Flue app uses model configuration through Flue (`apps/flue/src/agents/transaction-categorizer.ts`), not direct `@ai-sdk/openai`/`ai` dependencies in `@penge/web`.

### Behavior replacement

The legacy web stack performed these functions:

- claim a small batch by setting `bank_transactions.ai_processing_started_at`
- load eligible categories
- load ranked similar confirmed single-category examples
- call OpenAI synchronously from the web app
- apply category or unable results with confidence and reasoning
- clean up processing markers in `finally`

The active Flue stack replaces the behavior at better boundaries:

- workflow start and visibility: `agent_workflow_runs`
- category discovery: `searchLedgerAccounts` plus domain validation
- examples/context: scoped `searchBankTransactions`, `getBankTransactionDetail`, and `searchLedgerTransactions`
- apply behavior: `applyAgentBankTransactionInterpretation` via `applyCategorizationSuggestion`
- stale protection: `categorization_revision` CAS rather than a row processing marker
- team authorization: trusted scope passed from web and enforced in domain reads/writes

The only behavior not copied exactly is the deterministic ranked similar-example prompt payload from `similar-categorization-examples.server.ts`. That is acceptable for this deletion: current reference docs say Flue searches broadly for historical context, and the Flue tool set can inspect confirmed ledger examples and details under trusted scope. Do not preserve the old helper just because it exists. If agent quality later needs deterministic merchant/example retrieval, design a new Flue-oriented read projection rather than moving this web prompt-shaping helper wholesale.

## 4. Proposed deletion/collapse

Delete the obsolete web-side AI categorization implementation and let the Flue workflow remain the single AI categorization path.

Implementation should:

1. delete `apps/web/src/ledger/ai-categorization.server.ts`
2. delete `apps/web/src/ledger/similar-categorization-examples.server.ts`
3. delete tests that only target those files
4. remove web package dependencies that only supported direct OpenAI calls
5. remove web `OPENAI_API_KEY` example/config references
6. update any non-archive docs/review notes that still describe the old web stack as present
7. run focused grep validation to prove no production or non-archive test references remain

Do not introduce compatibility exports or replacement wrappers for the deleted module names. The point is to remove the parallel orchestration path.

## 5. Files to delete

Delete these source files:

- `apps/web/src/ledger/ai-categorization.server.ts`
- `apps/web/src/ledger/similar-categorization-examples.server.ts`

Delete these tests:

- `apps/web/tests/unit/ledger-ai-categorization-server.test.ts`
- `apps/web/tests/unit/ledger-similar-categorization-examples.test.ts`

Rationale: after source deletion, these tests only preserve behavior of a removed synchronous web path. Rewriting them as absence tests would be low-value.

## 6. Files to modify

### Required

- `apps/web/package.json`
  - remove `@ai-sdk/openai`
  - remove `ai`
- `pnpm-lock.yaml`
  - update by running the package manager after removing the dependencies; do not hand-edit the lockfile
- `apps/web/.env.example`
  - remove `OPENAI_API_KEY=replace-with-openai-api-key`

### Likely docs/review cleanup

- `REVIEW.md`
  - if this untracked review handoff remains in the working tree, update or remove finding #1 so it does not continue saying the legacy files still exist after implementation
- `docs/reference/ai-categorization.md`
  - no required architecture rewrite; it already describes Flue as the active path
  - optional small cleanup: keep references to historical examples as Flue-readable context, but avoid implying the web builds prompt batches

### Do not modify in this cleanup

- generated Drizzle migrations under `apps/web/drizzle/`
- generated Drizzle metadata under `apps/web/drizzle/meta/`
- generated Zero schema at `apps/web/src/zero/schema.ts`
- `packages/domain/src/schema.ts`
- `apps/web/drizzle-zero.config.ts`

The database columns for `aiConfidence`, `aiReasoning`, `aiProcessingStartedAt`, and `categorizationRevision` remain in use or require a separate migration-oriented simplification.

## 7. Tests to delete, migrate, or keep

### Delete

- `apps/web/tests/unit/ledger-ai-categorization-server.test.ts`
  - covers removed web batching, direct OpenAI schema/prompt, old `MAX_AI_CATEGORIZATION_BATCH_SIZE`, and row-level processing marker cleanup
- `apps/web/tests/unit/ledger-similar-categorization-examples.test.ts`
  - covers removed web prompt-context ranking helper

### Keep

- `apps/web/tests/unit/ledger-ai-categorization-fns.test.ts`
  - proves the public AI server handlers delegate to Flue
- `apps/web/tests/unit/flue-categorization-web-start.test.ts`
  - proves web authorization/reservation/invocation behavior
- `apps/web/tests/unit/flue-categorization-http-invocation.test.ts`
  - proves the web starter calls Flue over HTTP with token and payload
- `apps/web/tests/unit/flue-categorization-workflow.test.ts`
  - proves workflow lifecycle and prompt/tool wiring
- `apps/web/tests/unit/flue-agent-read-tools.test.ts`
  - proves trusted scoped read tools
- `apps/web/tests/unit/domain-read-projections.test.ts`
  - proves domain read projection scoping and compact output
- `apps/web/tests/unit/flue-agent-write-tools.test.ts`
  - proves guarded Flue AI writes, unable results, confidence handling, transfers, target constraints, and CAS conflicts
- `apps/web/tests/unit/ledger-categorization-server.test.ts`
  - keeps manual/domain categorization semantics, including AI metadata clearing and confirmation behavior
- schema/Zero tests that assert `bank_transactions` AI metadata fields remain synced

### Do not migrate by default

Do not migrate the old deterministic similar-example ranking tests unless a new product requirement asks for deterministic ranked examples in Flue tools. The current Flue design is intentionally agentic and broad-search based, not a direct prompt-batch port.

If quality issues later justify a new projection, add focused tests near `packages/domain/src/read-projections.ts` or Flue read tools for the new projection only.

## 8. Dependency/env/docs cleanup

### Web dependencies

Remove from `apps/web/package.json`:

```json
"@ai-sdk/openai": "3.0.73",
"ai": "6.0.208"
```

Then run a package-manager command that updates `pnpm-lock.yaml`, for example:

```bash
pnpm --filter @penge/web remove @ai-sdk/openai ai
```

If the command does more than remove these dependencies, inspect the lockfile diff carefully and keep only expected dependency graph cleanup.

### Environment variables

Remove `OPENAI_API_KEY` only from `apps/web/.env.example`.

Keep `apps/flue/.env.example`:

```txt
OPENAI_API_KEY=""
```

The model provider key now belongs to Flue, not the web app.

### Documentation

Non-archive docs should describe the single active path:

- web server functions start Flue workflows
- Flue performs model/tool work
- domain services guard writes
- Zero observes resulting domain rows

Archive specs under `docs/archive/specs/` should not be edited for this cleanup; they are historical evidence.

## 9. Risks and validation needed

### Risks

- **Hidden import missed by grep:** TypeScript/build will catch unresolved imports after deleting the files.
- **Dependency still used indirectly in web:** grep should prove there are no `@ai-sdk/openai` or `from 'ai'` imports outside deleted files/tests before removing dependencies.
- **Docs confusion:** `apps/flue/.env.example` must keep `OPENAI_API_KEY`; only web loses it.
- **Quality regression fear around similar examples:** the deterministic web helper is not active today. Removing it does not change current production behavior. Any future deterministic example-search feature should be designed for Flue tools, not preserved as web prompt code.
- **Row-level processing state remains:** `ai_processing_started_at` still affects manual guards, optimistic mutators, UI model, schema, Zero, and tests. Removing it is a separate migration/design task and should not be bundled with this deletion.

### Focused validation commands

Run from workspace root after implementation:

```bash
rg "aiCategorizeBankTransactions|categorizeWithOpenAI|loadSimilarCategorizationExamples|AiCategorization" apps packages docs -g '!docs/archive/**'
rg "@ai-sdk/openai|from 'ai'|OPENAI_API_KEY" apps packages docs package.json apps/*/package.json -g '!docs/archive/**'
rg "startFlueCategorize|categorize-transactions|applyCategorizationSuggestion" apps packages docs -g '!docs/archive/**'
pnpm --filter @penge/web typecheck
pnpm --filter @penge/web test ledger-ai-categorization-fns.test.ts flue-categorization-web-start.test.ts flue-categorization-http-invocation.test.ts flue-categorization-workflow.test.ts flue-agent-read-tools.test.ts flue-agent-write-tools.test.ts domain-read-projections.test.ts
pnpm --filter @penge/flue typecheck
```

Expected grep results:

- first command should return no non-archive source/test references after deletion, except possibly the new cleanup spec itself if the grep includes `docs/specs`
- second command should show `OPENAI_API_KEY` in `apps/flue/.env.example` only, plus any intentional spec/review notes; it should not show web source, web tests, or `apps/web/package.json`
- third command should continue showing active Flue/web workflow references

Optional broader validation before merge:

```bash
pnpm --filter @penge/web test
pnpm check
```

Use known local-test caveats from `docs/INBOX.md` when interpreting full-suite or Playwright failures.

## 10. Non-goals

- Do not remove, rename, or migrate `bank_transactions.ai_processing_started_at` in this cleanup.
- Do not remove `bank_transactions.ai_confidence`, `ai_reasoning`, or `categorization_revision`.
- Do not edit generated Drizzle migrations, migration metadata, or Zero schema by hand.
- Do not change Flue workflow prompt behavior or model selection.
- Do not introduce a new deterministic similar-example projection unless a separate requirement asks for it.
- Do not change UI status-dot behavior.
- Do not change the public server-function names `aiCategorizeTransaction` or `aiCategorizeNeedsReviewBatch`; those remain the UI-facing start actions.

## 11. Recommended implementation sequence

### PR 1 — Delete the obsolete web AI stack

1. Re-run the evidence greps from this spec and confirm the legacy files are still only referenced by their own tests and non-archive notes.
2. Delete:
   - `apps/web/src/ledger/ai-categorization.server.ts`
   - `apps/web/src/ledger/similar-categorization-examples.server.ts`
   - `apps/web/tests/unit/ledger-ai-categorization-server.test.ts`
   - `apps/web/tests/unit/ledger-similar-categorization-examples.test.ts`
3. Remove web dependencies with `pnpm --filter @penge/web remove @ai-sdk/openai ai`.
4. Remove `OPENAI_API_KEY` from `apps/web/.env.example`; keep it in `apps/flue/.env.example`.
5. Update `REVIEW.md` or other non-archive notes if they still describe the deleted files as present.
6. Run focused grep validation.
7. Run focused tests and typechecks listed in section 9.
8. Inspect the diff for accidental generated-file edits or unrelated cleanup.

This PR should be mostly deletion and package/env cleanup.

### PR 2 — Optional follow-up: retire row-level processing state

Design separately if the team wants to remove the second concurrency model. That work would need a migration and coordinated changes across:

- `packages/domain/src/schema.ts`
- `apps/web/drizzle-zero.config.ts`
- generated migrations and Zero schema
- `packages/domain/src/categorization-service.ts`
- `apps/web/src/zero/mutators.ts`
- `apps/web/src/components/ledger/ledger-dashboard-model.ts`
- schema/Zero/dashboard/domain tests
- `docs/reference/ai-categorization.md` and `docs/reference/transaction-categorization.md`

Do not include PR 2 in the legacy web-stack deletion unless implementation proves the deleted files are the only remaining writer of `aiProcessingStartedAt` and the team explicitly approves that broader migration.
