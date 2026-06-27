# Reference docs

These docs describe how Penge currently works from a product/system-design perspective. They synthesize the implemented specs in `docs/specs/` and the current code, rather than preserving every detail from the historical specs.

The specs are useful design history, but they are not always the best entry point for understanding the current system. Start here when you need to know what functionality exists, how the pieces fit together, or why a non-obvious product decision was made.

## Current reference map

- [Product principles](./product-principles.md) — the core philosophy: immutable bank evidence, replaceable ledger interpretation, team-scoped data, and user-facing language.
- [Accounting and ledger model](./accounting-and-ledger.md) — bank transactions, ledger transactions, signed postings, reconciliation, balances, and account history semantics.
- [Money representation and display](./money.md) — canonical scale-4 integer money amounts, provider parsing, integer arithmetic, and the shared `Currency` display component.
- [Transaction review and categorization](./transaction-categorization.md) — the Transactions page, category selector, splits, transfers, confirmation dots, and clear-categorizations reset.
- [AI categorization](./ai-categorization.md) — Flue workflow orchestration, workflow visibility, confidence, agent tools, reasoning, and guarded application of AI interpretations.
- [Team data assistant](./team-data-assistant.md) — Ask Penge chat, web-to-Flue proxying, scoped reads, confirmed chat writes, and category-management guardrails.
- [Categories](./categories.md) — category groups, editable categories, locked system accounts, balances, and deletion rules.
- [Bank accounts and sync](./banking.md) — GoCardless linking, bank accounts, sync-all, sync state, and imported transaction facts.
- [App shell and navigation](./app-shell.md) — sidebar navigation, page-owned layout, breadcrumbs, page action placement, and the Ask Penge chat surface.

## Deliberately not current

`docs/specs/2026-06-20-refresh-safe-long-running-tasks-design.md` is not implemented as a general pattern. Bank sync still runs through server functions that await the work before returning. AI categorization now uses its own Flue workflow path with team-level `agent_workflow_runs` visibility rather than the row-level processing-claim design from that spec.
