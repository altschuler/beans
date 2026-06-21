# TODO

## Categories

- Implement deletion/archival for non-empty categories. Current editable-category work should only allow hard deletion when a category has zero ledger postings; categories with historical postings need an archival/deactivation flow instead.

## Category management cleanup

- Replace custom category-management form controls with shadcn-style primitives. Still relevant: `src/components/ledger/category-management-dialogs.tsx` hand-styles a native `textarea`, `select`, radio inputs, and `category-management-page.tsx` renders the type pill as a raw `span`.
  - Add missing primitives under `src/components/ui/` first, following the existing shadcn wrapper pattern and token usage: `Textarea`, `Select`, `RadioGroup`/`RadioGroupItem`, and `Badge`.
  - Update `CategoryDialog` to use `Textarea` for description, `Select` for group choice, and `RadioGroup` for type choice while preserving the current controlled form state, labels, option descriptions, disabled/pending behavior, and submit payload shape.
  - Update the category row type pill to use `Badge` rather than a hand-styled `span`.
  - Prefer tests that render the real UI primitives; only mock browser/Radix gaps that make the test impractical.
- Simplify category management dialog mounting. Still relevant: `src/components/ledger/category-management-page.tsx` mounts four dialogs at all times and uses `key` resets plus repeated `dialog.kind` guards.
  - Render only the active dialog from a `switch`/helper on `dialog.kind`, or make form resets explicit inside the dialog components. Avoid keeping closed dialogs mounted just to preserve reset behavior.
  - Keep the current stacked flow intact: Add category → Add group should return to category creation, and successful group creation should pass the new group id back as `initialGroupId`.
  - Once only the active dialog is rendered, remove unnecessary `key` reset props and reduce inline `dialog.kind === ... ? ... : ...` guards.
- Derive category/group dialog titles and descriptions from dialog mode instead of passing repeated copy from `CategoryManagementPage`.
  - Move the create/edit title and description constants into `CategoryDialog` and `GroupDialog`, keyed by `mode`, or expose a small local helper in `category-management-dialogs.tsx`.
  - Keep delete-section copy data-driven from `category`/`group.deleteDisabledReason`; only the static dialog chrome should be derived from mode.
  - After this, callers should pass `mode`, entity data, and callbacks, not repeated `title`/`description` strings.
- Drop low-value category-management Zero mutator dispatch tests in `tests/unit/zero-mutators.test.ts`. Still relevant: the tests named `runs category account management on the server transaction` and `runs category group management on the server transaction` mostly assert mocked pass-through argument plumbing.
  - Keep the Zod input schema tests for category account/group mutators; those protect the public Zero input boundary.
  - Rely on `tests/unit/category-management-server.test.ts` for authorization, editability, deletion, trimming, and persistence behavior.
  - If a Zero server-mutator smoke test is still desired, keep at most one generic test for the server transaction/user-id seam rather than one assertion per category-management command.
- Inline `normalizeName` in `src/ledger/category-management.server.ts`. Still relevant: it only calls `requireNonEmpty(value, message)` and adds no domain-specific behavior.
  - Replace `normalizeName(input.name, '...')` calls with `requireNonEmpty(input.name, '...')`, then delete `normalizeName`.
  - Preserve the current trim-and-empty-validation behavior; no behavior change or new test should be needed.
- Keep `tests/unit/category-management-page.test.ts` focused on page-level behavior. Still relevant: it currently mixes page rendering assertions with direct `CategoryDialog`/`GroupDialog` static markup checks and broad absence assertions.
  - Page tests should cover page-owned behavior only: query/model filtering into the visible list, header actions, lock/edit affordances, and the mutation/dialog boundary if tested with an interactive renderer.
  - Move valuable dialog-internal coverage to a focused `tests/unit/category-management-dialogs.test.tsx` (for delete section disabled copy, Add group callback, initial group selection, submit payloads), or drop static markup checks that only restate component structure.
  - Avoid absence-only assertions for removed markup unless the absence is a durable product rule; prefer positive behavior assertions backed by `category-management-model.test.ts` and `category-management-server.test.ts`.

## Transaction categorization

- Give transfer confirmation failures their own error message. `validateConfirmableInterpretationPostings` (`src/ledger/categorization.server.ts`) throws `'Transaction must have a category before it can be confirmed'` for every transfer-branch failure (wrong posting count, amount/currency mismatch, not two distinct accounts), which is nonsensical for a transfer. Use a transfer-specific message.
- Confirm whether re-categorizing a bank-import transaction should reset `date`/`description` to the bank transaction's values. The unified `applyBankTransactionInterpretation` deletes and recreates the ledger transaction, overwriting these fields each time (the old in-place `categorizeLedgerTransaction` left them untouched). Fine only if those fields are never user-editable on bank-import transactions.
- Consider taking `FOR UPDATE` on the confirm loader (`loadSingleReconciledPostingForBankTransaction`) for symmetry with the categorize path. Two concurrent user actions (categorize + confirm on the same bank transaction) aren't serialized by a shared row lock; the outcome is currently safe (confirm's guarded UPDATE throws on 0 rows) but surfaces the misleading "being categorized by AI" message.
- Keep ledger transaction ids stable across re-categorization. `applyBankTransactionInterpretation` (`src/ledger/categorization.server.ts`) deletes the existing ledger transaction and inserts a new one with a fresh `crypto.randomUUID()` on every category/split/transfer change. Because Zero syncs `ledgerTransactions`/`ledgerPostings` by their own PKs, a churned id propagates to every client as a delete + insert instead of an update (extra sync traffic, and it breaks any future client-side optimism — see "Zero review"). The dashboard/detail models also key lookups by `ledgerTransaction.id`.

  How to fix (stabilize the transaction id; posting ids can still churn):
  1. When `existing` is present, reuse `existing.ledgerTransaction.id` instead of minting a new `ledgerTransactionId`. When `existing` is null, keep today's insert-new-transaction path.
  2. Replace the row delete+insert with an in-place update. **Do the guarded UPDATE first**, before deleting any postings: `UPDATE ledgerTransactions SET (status, date, description, categorizedBy, userConfirmedAt, userConfirmedBy, updatedAt) WHERE id = existing.id [AND status = requiredExistingStatus] RETURNING id`. If it returns 0 rows, `return false` — at this point nothing has been destroyed.
     - Ordering matters: `return false` inside the outer `db.transaction` does **not** roll back, so deleting postings before the guard check would commit a transaction stripped of its postings (data loss).
     - This guarded UPDATE replaces today's guarded DELETE (`deleteLoadedInterpretation`) as the `requiredExistingStatus` optimistic-concurrency check.
  3. Then delete the existing postings for that id and insert the new postings under the same id; run `validatePersistedTransactionBalance`.
  4. Preserve the original `createdAt` (only bump `updatedAt`) — the interpretation has existed since then.
  5. Add a test asserting `ledgerTransaction.id` is unchanged after re-categorizing a bank transaction (category → different category, and category → split).

  Tradeoff: this re-introduces an `existing ? update : insert` branch into the unified function — lighter than the old `categorizeLedgerTransaction` (postings are still fully rebuilt; only the row + id + createdAt are preserved). Stabilizing posting ids too (e.g. the reconciled bank posting) is more work and more of a regression toward the removed in-place code; skip unless there's a concrete need.

## Review follow-up

- Add missing authorization coverage for the bank-transaction categorization paths. Still relevant: `tests/unit/ledger-categorization-server.test.ts` only has a category-path denial for `user-2` against an already-interpreted bank transaction; it does not directly cover split authorization or the fresh-import/no-existing-interpretation path by `bankTransactionId`.
  - Add tests at the server-function boundary, not Zero dispatch tests: call `categorizeBankTransaction` and `splitBankTransaction` inside `db.transaction` and assert persisted rows are unchanged or absent after denial.
  - Extend the fixture with a team-2 bank account, matching team-2 bank-linked ledger account, and an unreconciled team-2 bank transaction. Then assert `user-1` cannot categorize or split that team-2 bank transaction (`Bank transaction not found`) and no `ledgerPostings.bankTransactionId` row is created for it.
  - Keep the existing invalid-category account coverage, but add a cross-team category case on a fresh team-1 bank transaction if it is not already explicit enough for the path being changed. The expected error should remain `Invalid categorization account` without creating a new interpretation.
  - Focus on observable authorization outcomes: denied result/error plus no persisted interpretation. Avoid asserting Drizzle join shape or internal helper calls.
- Drop or replace the low-value transfer selector test in `tests/unit/transaction-table.test.ts`. Still relevant: `keeps transfer choices available through row props for selector filtering` only proves the table renders a selector trigger and lacks a native `<select>`; it does not prove transfer filtering, labels, or selection behavior.
  - Prefer deleting that table-level test unless `TransactionTable` itself owns a transfer-specific contract. The table should only need a narrow boundary test that rows receive `transferAccounts` if that plumbing is otherwise easy to break.
  - Put meaningful transfer coverage in focused category-selector tests: exclude the current row's own bank account from transfer options, label negative amounts as `Transfer to: <account>` and positive amounts as `Transfer from: <account>`, filter transfer options by the search text, and call `onChoose({kind: 'transfer', accountId})` when a transfer option is selected.
  - If selector tests are rewritten to render real popover/UI primitives, cover this through user-visible options and clicks rather than `renderToStaticMarkup` string checks or button-recorder mocks.

## Auth review

- Clear or intentionally retain Zero local data on logout. Current sign-out only calls Better Auth and navigates away; Zero docs note synced IndexedDB data remains unless `zero.delete()` is called.
- Document and harden production Zero cookie deployment. If `zero-cache` runs on a subdomain, Better Auth cookies need appropriate cross-subdomain configuration, and auth cookies must not use `SameSite=None`.
- Add handling for Zero `needs-auth` connection state after query/mutate endpoints return `401`, so expired sessions can reconnect after login or route users back to sign-in cleanly.
- Remove production risk from auth development defaults: fail fast on missing production `BETTER_AUTH_SECRET`, and ensure prefilled test credentials in the auth form are dev/test-only.
- Add focused auth/Zero tests for unauthenticated query/mutate `401`s, authenticated server-verified `userID` propagation, and auth tables remaining excluded from Zero schema generation.

## Zero review

Findings from an idiomatic-usage review against the official Zero docs. The plumbing (custom synced queries + custom mutators, multi-tenant security) is correct; these items are about getting Zero's value (optimistic writes, instant reads) and fixing two data-correctness issues. See also the "Auth review" section above for overlapping production-cookie and `needs-auth` items.

### Decide / correctness

- Decide and document the empty client mutators. All four client mutators are no-ops (`src/zero/mutators.ts:32-39`) so there are no optimistic updates — categorize/split/confirm/clear wait for a full server round-trip, defeating Zero's core benefit. This is partly forced: `categorization.server.ts` does transfer-matching, `FOR UPDATE` locking, and balance validation that can't be mirrored client-side. Either (a) keep server-authoritative and document the tradeoff (comment in `mutators.ts` + a "saving…" UI state), or (b) add optimism only for the deterministic single-`category` case via `tx.mutate.ledgerPostings.insert(...)`. Right now it reads as an unfinished stub.
- Fix monetary precision: money is synced as float64. `numeric(18,4)` columns (`bank_transactions.amount`, `ledger_postings.amount`) map to Zero `number`, so values pass through IEEE-754 in transit before the client's `String(amount)`. Add a per-column string/custom-type override in `drizzle-zero.config.ts` (same mechanism as `zeroString().from('sync_status')`), regenerate, and add a fractional round-trip test. (`src/zero/schema.ts` is generated — fix at the config source.)

### Reads

- Add query preloading. No `zero.preload()` exists anywhere; the same ~7 team-scoped queries back every page, so each navigation re-syncs. Preload the core set after `AppZeroProvider` mounts (biggest perceived-perf win for least code). Set an intentional `ttl` on the preload instead of relying on the implicit 5-minute default.
- Use ZQL `.related()` + server-side filtering instead of client-side joins. `ledger-postings-page.tsx` and `ledger-dashboard-model.ts` load 4+ full tables and rebuild relationships with `Map` lookups despite the schema defining `ledgerPostings.ledgerTransaction/.account/.bankTransaction`. `ledger-account-detail.tsx` loads six full tables to render one account without narrowing by `accountId` in ZQL. Push filtering into ZQL and use `.related()`.
- Gate not-found/empty UI on `status.type === 'complete'`. Consumers discard the status half of the `useQuery` tuple, so `ledger-account-detail.tsx` can flash "Account not found" before the first sync arrives (same class of bug for "No transactions yet" empty states). Take the status from the tuple, or adopt `useSuspenseQuery`.

### Schema / config

- Stop syncing `bank_transactions.raw`. The full provider payload is replicated to every client's local store and is never read in the UI. Set `raw: false` in `drizzle-zero.config.ts` and regenerate; keep it in Postgres for server reprocessing.
- Add production zero-cache config before deploy. Only `ZERO_UPSTREAM_DB` is set; dev relies on `zero-cache-dev` defaults. Separate `ZERO_CVR_DB`/`ZERO_CHANGE_DB`, set `ZERO_ADMIN_PASSWORD`, configure a persistent `ZERO_REPLICA_FILE`, enable CVR garbage collection, and define an explicit publication.

### Cleanups (minor)

- Extract the duplicated permission predicate. The nested `whereExists('team' → 'members' → userId)` is copy-pasted across all 8 queries in `src/zero/queries.ts`; a missing filter on a new table would silently leak data. Extract a shared helper, and consider resolving the user's `teamId` into `ctx` server-side so leaf queries become a flat `where('teamId', …)` (cheaper than a 3-level correlated subquery per sync).
- Add cross-tenant isolation tests for each query — the type system won't catch a missing `whereExists`.
- Drop or comment the redundant `context={{userID}}` prop on `ZeroProvider` (`src/components/zero/app-zero-provider.tsx`); the server re-derives `userID` from the session and ignores client context, so the prop can mislead future maintainers into thinking it's trusted.
- Revisit the `mustGetMutator` + manual `as` cast in `src/routes/api/zero/mutate.ts:24-27`, which bypasses Zero's types — check whether the server adapter offers a typed dispatch overload; if not, add an explanatory comment.
- Prefer `NODE_EXTRA_CA_CERTS` over `NODE_TLS_REJECT_UNAUTHORIZED=0` in the `dev:zero` script (the `build` script already does this); confirmed not in the `start` path.
