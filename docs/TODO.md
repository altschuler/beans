# TODO

## Categories

- Implement deletion/archival for non-empty categories. Current editable-category work should only allow hard deletion when a category has zero ledger postings; categories with historical postings need an archival/deactivation flow instead.

## Category selector

- Restore transaction-row virtualization measurement after the category selector/split popover change. `src/components/transaction-table/transaction-table.tsx` no longer passes `rowVirtualizer.measureElement` to `TransactionRow`, but rows are still positioned from a fixed `estimateSize: () => 56`; long descriptions/categories or actual row-height drift can cause overlap, gaps, or incorrect scroll range. Restore the row ref/`measureElement` wiring or enforce a truly fixed row height with matching truncation.
- Add focused test coverage that proves the virtualizer measurement ref is wired to rendered transaction rows. The mock still exposes `measureElement`, but the last commit removed the production wiring without a failing test.
- Collapse the one-off `CategorySelectorContent` boundary unless it starts owning cohesive behavior. It has one production caller and mostly passes through selector state, setters, and callbacks from `CategorySelector`; inline it back into `CategorySelector` while keeping `SplitEditor` separate, or move the relevant state/handlers into the child.
- Reduce category-selector test scaffolding duplication. The new selector/split tests repeat large `TransactionTableRow` fixtures and button-recorder mocks; add a small shared row builder/test helper, or collapse the tests that become unnecessary if `CategorySelectorContent` is inlined.
- Replace over-mocked selector/popover tests with real UI behavior where practical. The new tests mock `Button` and make `Popover` a passthrough, so closed popover content is always present and Radix/shadcn integration/accessibility regressions can be hidden; render real primitives in a DOM-oriented test and mock only unavoidable browser gaps.
- Inline low-value split-line helpers such as `normalizeSplitLines` and `canRemoveSplitLine`; they only wrap local length/defaulting expressions. Keep helpers that encode real behavior, such as remaining-amount calculation.
- Split or drop unrelated category-management TODO additions from the category-selector commit if curating history. The backlog entries are useful, but they are not part of the category selector change.

## Category management cleanup

- Replace custom category-management form controls with shadcn components: use shadcn `Textarea` for description, `Select` for group selection, `RadioGroup`/`RadioGroupItem` for category type, and `Badge` for the category type pill instead of hand-styled native controls/spans.
- Simplify category management dialog mounting. `src/components/ledger/category-management-page.tsx` currently mounts all dialogs and uses `key` resets plus repeated `dialog.kind` guards; render only the active dialog or make form resets explicit.
- Derive category/group dialog titles and descriptions from dialog mode instead of passing repeated `mode`, `title`, and `description` props at each call site.
- Drop low-value category-management Zero mutator dispatch tests in `tests/unit/zero-mutators.test.ts`; schema tests plus `tests/unit/category-management-server.test.ts` cover the meaningful behavior.
- Inline `normalizeName` in `src/ledger/category-management.server.ts`; it only wraps `requireNonEmpty` without adding domain meaning.
- Keep `tests/unit/category-management-page.test.ts` focused on page-level behavior; move useful dialog-internal assertions to a focused dialog test or drop static markup checks that do not protect behavior.

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

- Add missing authorization coverage for the bank-transaction categorization paths, especially split categorization and fresh-import categorization by bank transaction id.
- Drop or replace the low-value transfer selector test in `tests/unit/transaction-table.test.ts`; meaningful coverage belongs in focused category-selector tests for transfer option filtering, direction labels, and selection callback payloads.

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
