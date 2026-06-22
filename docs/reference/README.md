# Reference docs

These docs describe how Penge currently works from a product/system-design perspective. They synthesize the implemented specs in `docs/specs/` and the current code, rather than preserving every detail from the historical specs.

The specs are useful design history, but they are not always the best entry point for understanding the current system. Start here when you need to know what functionality exists, how the pieces fit together, or why a non-obvious product decision was made.

## Current reference map

- [Product principles](./product-principles.md) — the core philosophy: immutable bank evidence, replaceable ledger interpretation, team-scoped data, and user-facing language.
- [Accounting and ledger model](./accounting-and-ledger.md) — bank transactions, ledger transactions, signed postings, reconciliation, balances, and account history semantics.
- [Money representation and display](./money.md) — canonical scale-4 integer money amounts, provider parsing, integer arithmetic, and the shared `Currency` display component.
- [Transaction review and categorization](./transaction-categorization.md) — the Transactions page, category selector, splits, transfers, confirmation dots, and clear-categorizations reset.
- [AI categorization](./ai-categorization.md) — AI confidence, processing state, similar examples, reasoning, and how AI suggestions are applied.
- [Categories](./categories.md) — category groups, editable categories, locked system accounts, balances, and deletion rules.
- [Bank connections and sync](./banking.md) — GoCardless linking, bank accounts, sync-all, sync state, and imported transaction facts.
- [App shell and navigation](./app-shell.md) — sidebar navigation, page-owned layout, breadcrumbs, and page action placement.

## Deliberately not current

`docs/specs/2026-06-20-refresh-safe-long-running-tasks-design.md` is not implemented. AI categorization and bank sync currently run through server functions that await the work before returning. The database does contain row-level processing fields, but the start-and-return background-task pattern from that spec should be treated as future work.
